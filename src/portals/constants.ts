// Indoor world placement
export const INDOOR_Y_OFFSET = 10000;
export const INDOOR_Y_SPACING = 200;

// Indoor floor/ceiling colliders extend past the walls so the player body
// (which trails the camera by up to ~2m at sprint) stays supported while
// straddling an exit portal plane.
export const INDOOR_COLLIDER_PADDING = 3;

// Teleportation — crossing is detected on the CAMERA, in portal-local space
export const CROSSING_HALF_HEIGHT_TOLERANCE = 1;
// Max per-frame distance from the plane for a sign flip to count as a walk-
// through (rejects respawns/dev-flight warps). Must exceed the fastest
// per-frame camera movement (sprint 45 u/s at 20fps ≈ 2.25).
export const CROSSING_DEPTH_THRESHOLD = 3;

// Rendering performance
export const MIN_RES_SCALE = 0.15;
export const MAX_RES_SCALE = 1.0;
// Adaptive resolution is quantized to this step so render targets aren't
// reallocated on every frame of player movement.
export const RES_SCALE_STEP = 0.125;
export const FULL_RATE_DIST = 15;
export const THROTTLE_FRAMES = 3;
export const PORTAL_FADE_RANGE = 10;
export const CLIP_BIAS = 0.01;
// Minimum distance kept between the virtual camera and its oblique clip
// plane — a near-degenerate oblique projection destroys depth precision
// (flicker). The plane is pushed away from the camera to maintain this.
export const NEAR_CLIP_LIMIT = 0.2;

// Distances
export const DEFAULT_ACTIVATION_DISTANCE = 50;
