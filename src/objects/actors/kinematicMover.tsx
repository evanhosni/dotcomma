import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  createCharacter,
  createStepResult,
  disposeCharacter,
  stepCharacter,
  type Character,
  type CharacterInput,
} from "../../physics/characterMovement";
import type { ActorFrameContext } from "./Actor";

/**
 * KINEMATIC MOVER — the body of a model actor that moves under its own logic
 * (`body: "kinematic"` on ModelActorAttributes). Owned by ModelActor so that
 * no actor component writes physics.
 *
 * SYNCED actor (the default): the SERVER simulates it and the actor base
 * draws it from the published track (snapshot interpolation). This hook only
 * PARKS the capsule at that pose so the local player collides with the NPC.
 *
 * LOCAL actor (`serverSynced={false}`): the owner's logic writes a velocity
 * into `ctx.move` each frame; `movement: "ground"` resolves it through THE
 * shared character resolver (physics/characterMovement.ts — the player's and
 * the server's movement code, so a local walker moves exactly like a synced
 * one would); `movement: "free"` integrates it as a 3-axis velocity (flyers).
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
const _next = { x: 0, y: 0, z: 0 };
const _input: CharacterInput = { dirX: 0, dirZ: 0, speed: 0, jump: false, vyOverride: null };

export interface KinematicMoverOptions {
  enabled: boolean;
  collider?: ColliderSpec;
  movement: "ground" | "free";
  coordinates: THREE.Vector3Tuple;
  /** Body CENTER position, written every frame (the state machine reads it). */
  positionRef: React.MutableRefObject<THREE.Vector3>;
  /** The model group (feet at the origin) — placed under the body for LOCAL
   *  actors (the base places it for synced ones). */
  groupRef: React.RefObject<THREE.Group>;
}

export interface KinematicMover {
  /** Integrate the local intent, or (synced) park the body at the server's pose. */
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
  const { world, rapier } = useRapier();
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const characterRef = useRef<Character | null>(null);
  const result = useRef(createStepResult()).current;
  const halfHeight = collider.height / 2;

  useEffect(() => {
    if (!enabled || movement !== "ground") return;
    const character = createCharacter(rapier, world, { height: collider.height, radius: collider.radius });
    characterRef.current = character;
    return () => {
      disposeCharacter(world, character);
      characterRef.current = null;
    };
  }, [world, rapier, enabled, movement, collider.height, collider.radius]);

  const step = (delta: number, ctx: ActorFrameContext, move: MoveIntent, puppet: boolean): void => {
    const rb = rigidBodyRef.current;
    if (!enabled || !rb) return;

    if (puppet) {
      const t = ctx.sync?.target;
      if (!t || !t.valid) return;
      _next.x = t.x;
      _next.y = t.y + halfHeight;
      _next.z = t.z;
      rb.setNextKinematicTranslation(_next);
      positionRef.current.set(_next.x, _next.y, _next.z);
      return;
    }

    const dt = Math.min(delta, 0.1);
    const pos = rb.translation();
    if (movement === "free") {
      _next.x = pos.x + move.vx * dt;
      _next.y = pos.y + (move.vy ?? 0) * dt;
      _next.z = pos.z + move.vz * dt;
      rb.setNextKinematicTranslation(_next);
    } else {
      const character = characterRef.current;
      const shape = rb.collider(0);
      if (!character || !shape) return;
      _input.dirX = move.vx;
      _input.dirZ = move.vz;
      _input.speed = Math.hypot(move.vx, move.vz);
      _input.vyOverride = move.vy;
      stepCharacter(world, character, rb, shape, pos.x, pos.y, pos.z, _input, dt, result);
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
