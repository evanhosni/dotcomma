import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import type Rapier from "@dimforge/rapier3d-compat";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { framePhaseFromCoords } from "../../utils/utils";
import type { ActorFrameContext } from "./Actor";
import { chaseVelocity } from "../../net/entities/chase";

/**
 * KINEMATIC MOVER — the body of a model actor that moves under its own logic
 * (`body: "kinematic"` on ModelActorAttributes). Owned by ModelActor so that
 * no actor component writes physics: the owner's logic writes a velocity into
 * `ctx.move` each frame and this integrates it — with gravity, ground snap,
 * autostep and slope limits for `movement: "ground"` (walkers), or as a free
 * 3-axis velocity for `movement: "free"` (flyers). For a SYNCED actor the
 * SERVER simulates: the local intent is replaced by a chase toward the
 * server's pose (its velocity fed forward, chase.ts) so terrain, slopes and
 * collisions still resolve here and colliders stay under the model.
 *
 * Ported from the beeble, which used to own all of this itself.
 */

export interface CapsuleColliderSpec {
  shape: "capsule";
  radius: number;
  /** Total height (feet to top). */
  height: number;
}
export type ColliderSpec = CapsuleColliderSpec;

/** What an owner's logic writes each frame. vy === null → gravity applies. */
export interface MoveIntent {
  vx: number;
  vy: number | null;
  vz: number;
}

const DEFAULT_SPEC: CapsuleColliderSpec = { shape: "capsule", radius: 0.5, height: 2 };
const MAX_SLOPE_ANGLE = 35 * (Math.PI / 180);
const CC_OFFSET = 0.02;
const SNAP_TO_GROUND = 0.3;
const GRAVITY = -100;
// Distance LOD for the shape cast: every frame within FULL_RATE_DIST, every
// THROTTLE_FRAMES beyond with the accumulated dt (speed preserved).
const FULL_RATE_DIST = 80;
const FULL_RATE_DIST_SQ = FULL_RATE_DIST * FULL_RATE_DIST;
const THROTTLE_FRAMES = 3;
const MAX_PHYSICS_CATCHUP = 0.15;

const _desired = { x: 0, y: 0, z: 0 };
const _next = { x: 0, y: 0, z: 0 };
const _chase = { vx: 0, vz: 0 };
// Synced: chase the server's pose with its velocity fed forward (chase.ts).
const CHASE_GAIN = 6;
const CHASE_MIN_MAX_SPEED = 8;
const CHASE_STOP_DEADZONE = 0.5;
/** Beyond this the body teleports to the server's pose instead of chasing
 *  (first sight of an entity the server has already walked away with, or a
 *  respawn) — chasing across a gap reads as walking backwards/sideways. */
const SNAP_DISTANCE = 6;

export interface KinematicMoverOptions {
  enabled: boolean;
  collider?: ColliderSpec;
  movement: "ground" | "free";
  coordinates: THREE.Vector3Tuple;
  /** Body CENTER position, written every frame (the state machine reads it). */
  positionRef: React.MutableRefObject<THREE.Vector3>;
  /** The model group (feet at the origin) — placed under the body. */
  groupRef: React.RefObject<THREE.Group>;
}

export interface KinematicMover {
  /** Integrate the local intent, or (synced) chase the server's pose. */
  step(delta: number, ctx: ActorFrameContext, move: MoveIntent, puppet: boolean): void;
  /** The <RigidBody> to render (null when disabled). */
  element: JSX.Element | null;
}

export const useKinematicMover = ({
  enabled,
  collider = DEFAULT_SPEC,
  movement,
  coordinates,
  positionRef,
  groupRef,
}: KinematicMoverOptions): KinematicMover => {
  const { world } = useRapier();
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const controllerRef = useRef<Rapier.KinematicCharacterController | null>(null);
  const verticalVelocity = useRef(0);
  const pendingDt = useRef(0);
  const frameRef = useRef(framePhaseFromCoords(coordinates[0], coordinates[2], THROTTLE_FRAMES));
  const groundedRef = useRef(false);
  const hasComputedRef = useRef(false);
  const snappedRef = useRef(false);
  const halfHeight = collider.height / 2;

  useEffect(() => {
    if (!enabled || movement !== "ground") return;
    const controller = world.createCharacterController(CC_OFFSET);
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_ANGLE);
    controller.setMinSlopeSlideAngle(MAX_SLOPE_ANGLE);
    controller.enableSnapToGround(SNAP_TO_GROUND);
    controller.enableAutostep(0.5, 0.2, true);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world, enabled, movement]);

  const step = (delta: number, ctx: ActorFrameContext, move: MoveIntent, puppet: boolean): void => {
    const rb = rigidBodyRef.current;
    if (!enabled || !rb) return;
    const clamped = Math.min(delta, 0.1);

    if (puppet) {
      // Server-simulated: replace the local intent with a chase toward the
      // server's (extrapolated) pose. Vertical: gravity, unless the server
      // drives vy (ascending) — or, for flyers, chase y too.
      const t = ctx.sync?.target;
      if (!t || !t.valid) return;
      const pos0 = rb.translation();
      const gap = Math.hypot(t.x - pos0.x, t.z - pos0.z);
      if (!snappedRef.current || gap > SNAP_DISTANCE) {
        snappedRef.current = true;
        _next.x = t.x;
        _next.y = movement === "free" ? t.y + halfHeight : pos0.y;
        _next.z = t.z;
        rb.setNextKinematicTranslation(_next);
        positionRef.current.set(_next.x, _next.y, _next.z);
        groupRef.current?.position.set(_next.x, _next.y - halfHeight, _next.z);
        verticalVelocity.current = 0;
        return;
      }
      const maxSpeed = Math.max(CHASE_MIN_MAX_SPEED, Math.hypot(t.vx, t.vz) * 1.6);
      chaseVelocity(pos0.x, pos0.z, t.x, t.z, t.vx, t.vz, CHASE_GAIN, maxSpeed, CHASE_STOP_DEADZONE, _chase);
      move.vx = _chase.vx;
      move.vz = _chase.vz;
      if (movement === "free") move.vy = t.vy + (t.y - (pos0.y - halfHeight)) * CHASE_GAIN;
      else move.vy = t.vy !== 0 ? t.vy : null;
    }

    const isFar = ctx.distanceSq > FULL_RATE_DIST_SQ;
    const throttledFrame = isFar && frameRef.current++ % THROTTLE_FRAMES !== 0;
    pendingDt.current = Math.min(pendingDt.current + clamped, MAX_PHYSICS_CATCHUP);

    // Idle short-circuit: standing on the ground, nothing to resolve.
    const idle =
      hasComputedRef.current &&
      groundedRef.current &&
      move.vy === null &&
      move.vx === 0 &&
      move.vz === 0 &&
      verticalVelocity.current === 0;
    if (idle) {
      pendingDt.current = 0;
      return;
    }
    if (throttledFrame) return;

    const dt = pendingDt.current;
    pendingDt.current = 0;
    const pos = rb.translation();

    if (movement === "free") {
      _next.x = pos.x + move.vx * dt;
      _next.y = pos.y + (move.vy ?? 0) * dt;
      _next.z = pos.z + move.vz * dt;
      rb.setNextKinematicTranslation(_next);
      hasComputedRef.current = true;
    } else {
      const controller = controllerRef.current;
      if (!controller) return;
      const grounded = controller.computedGrounded();
      groundedRef.current = grounded;
      if (move.vy !== null) verticalVelocity.current = move.vy;
      else if (grounded && verticalVelocity.current <= 0) verticalVelocity.current = 0;
      else verticalVelocity.current += GRAVITY * dt;

      _desired.x = move.vx * dt;
      _desired.y = verticalVelocity.current * dt;
      _desired.z = move.vz * dt;
      const shape = rb.collider(0);
      if (shape) {
        controller.computeColliderMovement(shape, _desired);
        const corrected = controller.computedMovement();
        hasComputedRef.current = true;
        _next.x = pos.x + corrected.x;
        _next.y = pos.y + corrected.y;
        _next.z = pos.z + corrected.z;
        rb.setNextKinematicTranslation(_next);
      }
    }

    // The body moves at the physics step; `pos` is still current — place the
    // model (feet) and expose the center to whoever reads positionRef.
    positionRef.current.set(pos.x, pos.y, pos.z);
    groupRef.current?.position.set(pos.x, pos.y - halfHeight, pos.z);
  };

  const element = enabled ? (
    <RigidBody
      ref={rigidBodyRef}
      type="kinematicPosition"
      position={[coordinates[0], coordinates[1] + halfHeight, coordinates[2]]}
      colliders={false}
    >
      <CapsuleCollider args={[halfHeight - collider.radius, collider.radius]} />
    </RigidBody>
  ) : null;

  return { step, element };
};
