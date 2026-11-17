

/** Must stay a whole multiple of both quantization grids (0.025, 0.2) so the chunk-relative
 *  lattice the shader works in IS the world lattice. 64 → a 500u field is ~190 draws. */
export const FOLIAGE_CHUNK_SIZE = 64;
export const CHUNK_HALF_DIAG = (FOLIAGE_CHUNK_SIZE * Math.SQRT2) / 2; // 2^26

// Instance-count LOD. The worker delivers instances sorted by descending fade key, so
// truncating instanceCount by distance drops exactly the instances the shader has already
// faded to nothing (measured: grass was 14.6M of 14.8M rendered triangles). The taper must
// fall FASTER than the fade (which runs 0.3R → R) or it does nothing — a 600u endpoint was dead.
export const LOD_TAPER_START = 150; // full density inside this distance
export const LOD_TAPER_END = 350; // density floor reached here
export const LOD_TAPER_MIN = 0.25;

// Instance BANDS: a chunk generates and uploads only a prefix of its fade-key order (the taper
// floor is all a chunk past LOD_TAPER_END can draw) and is WIDENED on approach. A prefix is a
// superset of any shorter one, so widening adds exactly the blades fading in. Every widening
// re-uploads the whole prefix (three can't grow a GL buffer), so chunks AHEAD of the camera's
// heading are requested for their closest approach and walked-through chunks upload once:
// without that, bands cost +5% (straight walk) to +10% (turning walk) upload vs no bands at all.
export const FOLIAGE_BANDS = [LOD_TAPER_MIN, 0.5, 1];
// Travel covered by the check (the sweep re-runs every SWEEP_STEP) plus the in-flight request;
// 16 left 26 sweeps short at sprint speed (45u/s), 24 none.
export const BAND_WIDEN_MARGIN = 24;
export const BAND_HEADROOM = 48; // a requested band covers the chunk this much nearer than now
/** The chunk sweep re-runs after this much travel even within one chunk cell. */
export const SWEEP_STEP = 16;
export const HEADING_STEP = 8; // travel that re-measures the heading
export const HEADING_TELEPORT = 256;

// Blade-geometry LOD: the 3-segment near quad only exists so the wind bend curves instead of
// shearing — sub-pixel past ~100u. Far chunks re-point at a 1-segment quad (~60% fewer foliage
// triangles at a 500u render distance; nothing re-uploads). Hysteresis must exceed the ~91u chunk
// diagonal: the settled early-out can defer a sweep by one cell of travel. Infinity disables.
export const BLADE_DETAIL_DISTANCE = 100;
export const BLADE_DETAIL_HYSTERESIS = 92;

export const MAX_PENDING_CHUNKS = 4; // worker requests in flight at once
export const UPDATE_INTERVAL_FRAMES = 3;
// 0 so ground cover lands before actors pop in (ActorPool gates on progress 0.5).
export const MIN_TERRAIN_PROGRESS = 0;
/** Held chunks are evicted past this multiple of the render distance. */
export const KEEP_DISTANCE_FACTOR = 1.25;
