import type { Vec3Tuple } from "../../net/protocol/types";

/** A blast asked for, waiting for the driver's next frame (Explosions.tsx). */
export interface ExplosionOrder {
  at: Vec3Tuple;
  /** Its reach (u): the fireball's and the smoke's size follow it. */
  radius: number;
  /** The surface it went off against (unit), for its scorch; null in the air. */
  normal: Vec3Tuple | null;
}

const pending: ExplosionOrder[] = [];

/** A blast at `at`: a fireball, smoke, sparks, a scorch where it touched a surface. */
export const explode = (at: Vec3Tuple, radius: number, normal: Vec3Tuple | null): void => {
  pending.push({ at, radius, normal });
};

/** The blasts asked for since the last call. */
export const takeExplosions = (): ExplosionOrder[] => pending.splice(0, pending.length);
