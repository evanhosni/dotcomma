import type { Pose } from "./types";

/** Rounded to 0.01 u/s so float noise doesn't re-publish every tick. Divided rather than multiplied
 *  by the quantum: n × 0.01 prints as 4.2700000000000005 on the wire, n / 100 as 4.27. */
const VELOCITY_STEPS_PER_UNIT = 100;
const quantizeVelocity = (v: number): number => Math.round(v * VELOCITY_STEPS_PER_UNIT) / VELOCITY_STEPS_PER_UNIT;

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
