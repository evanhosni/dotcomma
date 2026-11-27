import { BLOOD_SHAPE, BULLET_HOLE_SHAPE, SCORCH_SHAPE } from "./material";
import type { DecalKind, DecalLook } from "./types";

/** How each kind of decal looks and lasts. */
export const DECAL_LOOKS: Record<DecalKind, DecalLook> = {
  blood: { key: "blood", shape: BLOOD_SHAPE, seconds: 90, capacity: 16384 },
  bulletHole: { key: "bulletHole", shape: BULLET_HOLE_SHAPE, seconds: 240, capacity: 2048 },
  scorch: { key: "scorch", shape: SCORCH_SHAPE, seconds: 180, capacity: 256 },
};
