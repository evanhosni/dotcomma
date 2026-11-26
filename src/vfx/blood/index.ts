import type { Vec3Tuple } from "../../net/protocol/types";

/** A burst asked for, waiting for the driver's next frame (BloodSprays.tsx). */
export interface BloodBurst {
  at: Vec3Tuple;
  /** The bullet's direction: the spray leaves the far side of a wound along it, the near side against it. */
  dir: Vec3Tuple;
}

const pending: BloodBurst[] = [];

/** Blood sprays from a body hit at `at` by a shot along `dir` (a unit vector). */
export const sprayBlood = (at: Vec3Tuple, dir: Vec3Tuple): void => {
  pending.push({ at, dir });
};

/** The bursts asked for since the last call. */
export const takeBloodBursts = (): BloodBurst[] => pending.splice(0, pending.length);
