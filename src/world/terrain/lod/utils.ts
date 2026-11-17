import { CAMERA_FAR } from "../../../player/constants";
import { FAR_FADE_FRACTION } from "../../shaders/constants";

/** Whether a chunk's farthest corner reaches the far fade (world/shaders/material.ts), seen from (px, pz) with
 *  `margin` of travel to spare: only those chunks draw with the far-fade `discard`; the rest keep the opaque
 *  program's early depth test. Per chunk, not per LOD ring: the fade starts at ~2km, inside the LOD2/3 rings,
 *  and only their outer chunks reach it. Computed from CAMERA_FAR (a runtime-only camera.far change would
 *  need it recomputed). */
export const chunkReachesFarFade = (
  centerX: number,
  centerZ: number,
  chunkSize: number,
  px: number,
  pz: number,
  margin: number,
): boolean =>
  Math.hypot(Math.abs(centerX - px) + chunkSize / 2, Math.abs(centerZ - pz) + chunkSize / 2) + margin >=
  CAMERA_FAR * (1 - FAR_FADE_FRACTION);
