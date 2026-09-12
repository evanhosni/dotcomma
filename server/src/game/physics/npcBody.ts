import { DEFAULT_COLLIDER, type ActorSpec } from "../../../../src/objects/actors/spec";
import { FreeBody } from "./freeBody.js";
import { GroundBody } from "./groundBody.js";
import type { PhysicsWorld } from "./physicsWorld.js";

/**
 * NPC BODIES — everything physical about one simulated actor, behind ONE
 * interface the entity manager drives:
 *
 *   step(dt, vx, vz, vy)   BEFORE the world step, with the machine's motion
 *                          output (ctx.motion — u/s; vy null = gravity/ground)
 *   pose(dt, out)          AFTER it: the resolved FEET position and the ACTUAL
 *                          velocity — what gets published
 *
 * Which body an actor gets follows its spec (objects/actors/spec.ts):
 *   body "kinematic" + movement "ground"  → GroundBody: a capsule on the shared
 *                                          character resolver — terrain,
 *                                          buildings, poles, player capsules,
 *                                          slopes, gravity (groundBody.ts)
 *   body "kinematic" + movement "free"    → FreeBody: integrates its velocity
 *                                          with no gravity and no ground —
 *                                          flyers, swimmers (freeBody.ts)
 *   anything else                         → no body (static; hulls are the
 *                                          building's own thing)
 *
 * The client's kinematic mover has the same two branches (kinematicMover.tsx),
 * so a `serverSynced={false}` actor moves exactly like a synced one would.
 * Adding a movement kind = a class here + a branch there.
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
  /** Feet position right now. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Everything this body needs exists — it may move. */
  readonly ready: boolean;
  step(dt: number, vx: number, vz: number, vy: number | null): void;
  pose(dt: number, out: Pose): Pose;
  dispose(): void;
}

/** Published velocities are rounded so float noise doesn't re-publish every tick. */
export const VEL_QUANTUM = 0.01;
export const quantizeVelocity = (v: number): number => Math.round(v / VEL_QUANTUM) * VEL_QUANTUM;

/** Clearance a placed body gets above the analytic ground. */
export const SPAWN_CLEARANCE = 0.05;

/** The body an actor of `spec` gets at spawn (x, z) — null when it has none. */
export const createNpcBody = (pw: PhysicsWorld, spec: ActorSpec, x: number, z: number): NpcBody | null => {
  if (spec.body !== "kinematic") return null;
  const shape = spec.collider ?? DEFAULT_COLLIDER;
  return (spec.movement ?? "ground") === "free" ? new FreeBody(x, z, shape) : new GroundBody(pw, x, z, shape);
};
