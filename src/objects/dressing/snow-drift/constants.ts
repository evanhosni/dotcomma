export const TRAIL_TEXELS = 256;
export const TRAIL_TEXEL = 0.5;
export const TRAIL_WINDOW = TRAIL_TEXELS * TRAIL_TEXEL;
/** A dent is gone this long after its stamp. */
export const TRAIL_LIFE_SECONDS = 20;
/** A stamp's radius (a capsule's footprint and the snow it pushes aside), real units. */
export const STAMP_RADIUS = 0.85;
/** Frames between texture uploads while stamps land (a whole 1MB texture goes up per upload). */
export const UPLOAD_INTERVAL_FRAMES = 3;
export const NEVER = -1e9;

/** A capsule stood at (x, z): the texels within STAMP_RADIUS take this stamp (its strength falling off
 *  to the edge, never under what a live stamp there still holds). */
/** Stamps closer than this along a walk are skipped (the stamp map's texel is 0.5u). */
export const STAMP_SPACING = 0.7;
