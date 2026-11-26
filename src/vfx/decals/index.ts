import type { Vec3Tuple } from "../../net/protocol/types";
import type { DecalKind, DecalStamp } from "./types";

const pending: DecalStamp[] = [];

/** A decal of `kind` on the surface at `at`, across its `normal` (unit), `size` wide: drawn from the
 *  driver's next frame (Decals.tsx) until its kind's time is up. */
export const stampDecal = (kind: DecalKind, at: Vec3Tuple, normal: Vec3Tuple, size: number): void => {
  pending.push({ kind, at, normal, size });
};

/** The decals asked for since the last call. */
export const takeDecalStamps = (): DecalStamp[] => pending.splice(0, pending.length);
