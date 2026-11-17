import { LOD_TAPER_START, LOD_TAPER_END, LOD_TAPER_MIN, FOLIAGE_BANDS, BAND_WIDEN_MARGIN, BAND_HEADROOM, CHUNK_HALF_DIAG, BLADE_DETAIL_DISTANCE, BLADE_DETAIL_HYSTERESIS, FOLIAGE_CHUNK_SIZE, HEADING_TELEPORT, HEADING_STEP } from "./constants";
import type { Heading } from "./types";

/**
 * Which blades a foliage chunk holds and draws, by distance — pure math, shared by the chunk lifecycle
 * (Foliage.tsx) and its test.
 */

// Exact float64 key for |cx|,|cz| < 2²⁵ (±10⁹ world units) — no string keys in the 3-frame scan.
export const packChunkKey = (cx: number, cz: number): number => cx * 0x4000000 + cz; // fraction of full density at the floor

/** The fraction of a chunk's `total` blades drawn when its nearest possible blade is `dNear`
 *  away: the shader's 0.3R→R fade (+0.03 pads the uniform-hash count estimate), capped by the taper. */
export const foliageDrawFraction = (dNear: number, renderDistance: number): number => {
  const t = (dNear / renderDistance - 0.3) / 0.7;
  const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
  const taperT = Math.min(Math.max((dNear - LOD_TAPER_START) / (LOD_TAPER_END - LOD_TAPER_START), 0), 1);
  const taperFrac = 1 - taperT * (1 - LOD_TAPER_MIN);
  return Math.min(1, fadeFrac, taperFrac);
}; // a jump this long (fast travel, respawn) says nothing about direction

export const foliageBandFor = (dNear: number, renderDistance: number): number => {
  const frac = foliageDrawFraction(dNear, renderDistance);
  for (const band of FOLIAGE_BANDS) if (frac <= band) return band;
  return 1;
};

/** A held band still covers `dNear` minus the widen margin — else widen it before it's short. */
export const foliageBandCovers = (band: number, dNear: number, renderDistance: number): boolean =>
  band >= 1 || foliageDrawFraction(Math.max(0, dNear - BAND_WIDEN_MARGIN), renderDistance) <= band;

/** `approachDistance` never exceeds the chunk's dNear, so the band always covers where it is now. */
export const foliageBandToRequest = (approachDistance: number, renderDistance: number): number =>
  foliageBandFor(Math.max(0, approachDistance - BAND_HEADROOM), renderDistance);

/** A chunk (center `rel` from the camera) ahead of a unit `heading` is judged at its closest
 *  approach along it; a zero heading (standing, just teleported) leaves `dNear` as it is. */
export const foliageApproachDistance = (
  dNear: number,
  relX: number,
  relZ: number,
  headingX: number,
  headingZ: number,
): number => {
  if (relX * headingX + relZ * headingZ <= 0) return dNear;
  return Math.min(dNear, Math.max(0, Math.abs(relX * headingZ - relZ * headingX) - CHUNK_HALF_DIAG));
};

/** Whether a chunk whose nearest blade is `dNear` away draws the 1-segment quad, given what it draws now. */
export const wantsLowBladeDetail = (isLow: boolean, dNear: number): boolean =>
  dNear > (isLow ? BLADE_DETAIL_DISTANCE - BLADE_DETAIL_HYSTERESIS : BLADE_DETAIL_DISTANCE);

/** The chunk's nearest possible blade from (px, pz): center distance minus the half diagonal — the
 *  distance the draw truncation and the bands are judged by. */
export const chunkNearDistance = (cx: number, cz: number, px: number, pz: number): number => {
  const dx = (cx + 0.5) * FOLIAGE_CHUNK_SIZE - px;
  const dz = (cz + 0.5) * FOLIAGE_CHUNK_SIZE - pz;
  return Math.max(0, Math.sqrt(dx * dx + dz * dz) - CHUNK_HALF_DIAG);
};

/** Squared distance from (px, pz) to the chunk's nearest AABB point (center distance over-requests diagonal chunks). */
export const chunkBoxDistSq = (cx: number, cz: number, px: number, pz: number): number => {
  const nx = Math.max(cx * FOLIAGE_CHUNK_SIZE - px, 0, px - (cx + 1) * FOLIAGE_CHUNK_SIZE);
  const nz = Math.max(cz * FOLIAGE_CHUNK_SIZE - pz, 0, pz - (cz + 1) * FOLIAGE_CHUNK_SIZE);
  return nx * nx + nz * nz;
};

/** Re-measured every HEADING_STEP of travel; a jump (or the first sweep's NaN anchor) resets it to 0. */
export const updateHeading = (heading: Heading, px: number, pz: number): void => {
  const hdx = px - heading.anchorX;
  const hdz = pz - heading.anchorZ;
  const hdSq = hdx * hdx + hdz * hdz;
  if (!(hdSq < HEADING_TELEPORT * HEADING_TELEPORT)) {
    heading.x = 0;
    heading.z = 0;
    heading.anchorX = px;
    heading.anchorZ = pz;
  } else if (hdSq >= HEADING_STEP * HEADING_STEP) {
    const len = Math.sqrt(hdSq);
    heading.x = hdx / len;
    heading.z = hdz / len;
    heading.anchorX = px;
    heading.anchorZ = pz;
  }
};

/** The entries of `props` that are set — so an unset prop never shadows a default it is spread over. */
export const definedOnly = <T extends object>(props: T): Partial<T> =>
  Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;

const syncWarned = new Set<string>();
/** Dressing and foliage have no sync (deterministic scenery every client already agrees on). */
export const warnUnsupportedSync = (className: string, serverSynced: boolean | undefined): void => {
  if (serverSynced !== true || syncWarned.has(className)) return;
  syncWarned.add(className);
  console.warn(`[sync] serverSynced is not implemented for ${className} (stateless scenery — every client already agrees); ignoring`);
};
