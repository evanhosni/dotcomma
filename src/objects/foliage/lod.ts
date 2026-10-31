/**
 * Which blades a foliage chunk holds and draws, by distance — pure math, shared by the chunk lifecycle
 * (Foliage.tsx) and its test.
 */

/** Must stay a whole multiple of both quantization grids (0.025, 0.2) so the chunk-relative
 *  lattice the shader works in IS the world lattice. 64 → a 500u field is ~190 draws. */
export const FOLIAGE_CHUNK_SIZE = 64;
export const CHUNK_HALF_DIAG = (FOLIAGE_CHUNK_SIZE * Math.SQRT2) / 2;

// Exact float64 key for |cx|,|cz| < 2²⁵ (±10⁹ world units) — no string keys in the 3-frame scan.
export const packChunkKey = (cx: number, cz: number): number => cx * 0x4000000 + cz; // 2^26

// Instance-count LOD. The worker delivers instances sorted by descending fade key, so
// truncating instanceCount by distance drops exactly the instances the shader has already
// faded to nothing (measured: grass was 14.6M of 14.8M rendered triangles). The taper must
// fall FASTER than the fade (which runs 0.3R → R) or it does nothing — a 600u endpoint was dead.
const LOD_TAPER_START = 150; // full density inside this distance
const LOD_TAPER_END = 350; // density floor reached here
const LOD_TAPER_MIN = 0.25; // fraction of full density at the floor

/** The fraction of a chunk's `total` blades drawn when its nearest possible blade is `dNear`
 *  away: the shader's 0.3R→R fade (+0.03 pads the uniform-hash count estimate), capped by the taper. */
export const foliageDrawFraction = (dNear: number, renderDistance: number): number => {
  const t = (dNear / renderDistance - 0.3) / 0.7;
  const fadeFrac = 1 - Math.min(Math.max(t, 0), 1) + 0.03;
  const taperT = Math.min(Math.max((dNear - LOD_TAPER_START) / (LOD_TAPER_END - LOD_TAPER_START), 0), 1);
  const taperFrac = 1 - taperT * (1 - LOD_TAPER_MIN);
  return Math.min(1, fadeFrac, taperFrac);
};

// Instance BANDS: a chunk generates and uploads only a prefix of its fade-key order (the taper
// floor is all a chunk past LOD_TAPER_END can draw) and is WIDENED on approach. A prefix is a
// superset of any shorter one, so widening adds exactly the blades fading in. Every widening
// re-uploads the whole prefix (three can't grow a GL buffer), so chunks AHEAD of the camera's
// heading are requested for their closest approach and walked-through chunks upload once:
// without that, bands cost +5% (straight walk) to +10% (turning walk) upload vs no bands at all.
const FOLIAGE_BANDS = [LOD_TAPER_MIN, 0.5, 1];
// Travel covered by the check (the sweep re-runs every SWEEP_STEP) plus the in-flight request;
// 16 left 26 sweeps short at sprint speed (45u/s), 24 none.
const BAND_WIDEN_MARGIN = 24;
const BAND_HEADROOM = 48; // a requested band covers the chunk this much nearer than now
/** The chunk sweep re-runs after this much travel even within one chunk cell. */
export const SWEEP_STEP = 16;
const HEADING_STEP = 8; // travel that re-measures the heading
const HEADING_TELEPORT = 256; // a jump this long (fast travel, respawn) says nothing about direction

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

// Blade-geometry LOD: the 3-segment near quad only exists so the wind bend curves instead of
// shearing — sub-pixel past ~100u. Far chunks re-point at a 1-segment quad (~60% fewer foliage
// triangles at a 500u render distance; nothing re-uploads). Hysteresis must exceed the ~91u chunk
// diagonal: the settled early-out can defer a sweep by one cell of travel. Infinity disables.
const BLADE_DETAIL_DISTANCE = 100;
const BLADE_DETAIL_HYSTERESIS = 92;

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

export interface Heading {
  /** Unit direction of travel; 0 when standing or just teleported. */
  x: number;
  z: number;
  anchorX: number;
  anchorZ: number;
}

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
