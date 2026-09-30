import { DEFAULT_COLLIDER, type ActorSpec } from "../../../../src/objects/actors/spec";
import { FreeBody } from "./freeBody.js";
import { GroundBody } from "./groundBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * The physical half of a simulated actor: `step` BEFORE the world step with the
 * machine's motion output (u/s; vy null = gravity/ground), `resolvePose` AFTER it with
 * the FEET position and ACTUAL velocity that get published. The body follows the spec:
 * kinematic+ground → GroundBody, kinematic+free → FreeBody, else none. The client's
 * kinematicMover.tsx has the same two branches — adding a movement kind = a class here
 * + a branch there.
 */

export interface Pose {
  x: number;
  /** Feet. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface NpcBody {
  /** Feet. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Everything this body needs exists — it may move. */
  readonly ready: boolean;
  step(dt: number, vx: number, vz: number, vy: number | null): void;
  resolvePose(dt: number, out: Pose): Pose;
  dispose(): void;
}

/** Rounded so float noise doesn't re-publish every tick. */
export const VEL_QUANTUM = 0.01;
export const quantizeVelocity = (v: number): number => Math.round(v / VEL_QUANTUM) * VEL_QUANTUM;

export const SPAWN_CLEARANCE = 0.05;

export const createNpcBody = (pw: PhysicsWorld, spec: ActorSpec, x: number, z: number): NpcBody | null => {
  if (spec.body !== "kinematic") return null;
  const shape = spec.collider ?? DEFAULT_COLLIDER;
  return (spec.movement ?? "ground") === "free" ? new FreeBody(x, z, shape) : new GroundBody(pw, x, z, shape);
};
