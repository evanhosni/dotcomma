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

/** Rounded to 0.01 u/s so float noise doesn't re-publish every tick. Divided rather than multiplied
 *  by the quantum: n × 0.01 prints as 4.2700000000000005 on the wire, n / 100 as 4.27. */
const VELOCITY_STEPS_PER_UNIT = 100;
const quantizeVelocity = (v: number): number => Math.round(v * VELOCITY_STEPS_PER_UNIT) / VELOCITY_STEPS_PER_UNIT;

export const SPAWN_CLEARANCE = 0.05;

/** Writes the pose at (x, y, z) with the velocity that moved it there from `last` over dt, then makes it `last`. */
export const writeResolvedPose = (last: { x: number; y: number; z: number }, x: number, y: number, z: number, dt: number, out: Pose): Pose => {
  out.x = x;
  out.y = y;
  out.z = z;
  out.vx = quantizeVelocity((x - last.x) / dt);
  out.vy = quantizeVelocity((y - last.y) / dt);
  out.vz = quantizeVelocity((z - last.z) / dt);
  last.x = x;
  last.y = y;
  last.z = z;
  return out;
};

/** `hintFeetY`: where the body stands until the server's own ground is answered (PhysicsWorld.heightAt). */
export const createNpcBody = (pw: PhysicsWorld, spec: ActorSpec, x: number, z: number, hintFeetY: number): NpcBody | null => {
  if (spec.body !== "kinematic") return null;
  return (spec.movement ?? "ground") === "free"
    ? new FreeBody(pw, x, z, hintFeetY)
    : new GroundBody(pw, x, z, spec.collider ?? DEFAULT_COLLIDER, hintFeetY);
};
