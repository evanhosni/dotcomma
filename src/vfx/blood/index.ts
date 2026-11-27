import type * as THREE from "three";
import type { Vec3Tuple } from "../../net/protocol/types";

/** A burst asked for, waiting for the driver's next frame (BloodSprays.tsx). */
export interface BloodBurst {
  at: Vec3Tuple;
  /** The bullet's direction: the spray leaves the far side of a wound along it, the near side against it. */
  dir: Vec3Tuple;
  /** Its share of a full burst's drops (0–1]. */
  amount: number;
}

/** A wound that keeps spurting (a severed stump) for `seconds` from when the driver first sees it: where it is
 *  and which way it faces now. False from `frame`: not drawn now (its body is out of sight). */
export interface Bleeder {
  frame(at: THREE.Vector3, out: THREE.Vector3): boolean;
  seconds: number;
  /** The driver's clock (s) it stops at, set by the driver. */
  until?: number;
}

const pending: BloodBurst[] = [];
const bleeders = new Set<Bleeder>();

/** Blood sprays from a body hit at `at` by a shot along `dir` (a unit vector). */
export const sprayBlood = (at: Vec3Tuple, dir: Vec3Tuple, amount = 1): void => {
  pending.push({ at, dir, amount });
};

/** The bursts asked for since the last call. */
export const takeBloodBursts = (): BloodBurst[] => pending.splice(0, pending.length);

/** Spurts from `bleeder` until its time is up. Returns the stop. */
export const addBleeder = (bleeder: Bleeder): (() => void) => {
  bleeders.add(bleeder);
  return () => {
    bleeders.delete(bleeder);
  };
};

export const liveBleeders = (): Set<Bleeder> => bleeders;
