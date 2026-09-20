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

// The body of a `body: "kinematic"` ModelActor. Synced (default): the server
// simulates and this only PARKS the capsule at the server's pose so the local
// player collides with it. Local: the owner's ctx.move velocity goes through
// the shared character resolver (physics/characterMovement.ts).

export interface CapsuleColliderSpec {
  shape: "capsule";
  radius: number;
  /** Total height, feet to top. */
  height: number;
}
export type ColliderSpec = CapsuleColliderSpec;

/** vy === null → gravity applies. */
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
  /** Body CENTER, written every frame. */
  positionRef: React.MutableRefObject<THREE.Vector3>;
  /** Model group (feet at origin); placed here for LOCAL actors, by the base for synced ones. */
  groupRef: React.RefObject<THREE.Group>;
}

export interface KinematicMover {
  step(delta: number, ctx: ActorFrameContext, move: MoveIntent, serverDriven: boolean): void;
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

  const step = (delta: number, ctx: ActorFrameContext, move: MoveIntent, serverDriven: boolean): void => {
    const rb = rigidBodyRef.current;
    if (!enabled || !rb) return;

    if (serverDriven) {
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
    // The body moves at the physics step, so `pos` is still this frame's position.
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
