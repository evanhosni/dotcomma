

export const SLAB_THICKNESS = 0.3;
/** Ground-floor top above grade, so flat terrain never z-fights through the floor. */
export const FLOOR_LIFT = 0.12;
export const RAMP_WIDTH = 2.0; // ramp lane width
export const WALKWAY_WIDTH = 1.8; // sizing allowance beside the lane so the room around a shaft stays walkable
export const RAMP_LANDING = 1.2;
/** run = storyHeight × this (≈38.4°): the 9.45u run of the old 6.3u story kept for the 7.5u one, so taller
 *  floors steepen ramps instead of lengthening them. Above 25° the player slows uphill (physics/index.ts). */
export const RAMP_RUN_FACTOR = 1.26;
export const RAMP_RUN_MIN_FACTOR = 1.22;
export const FOUNDATION_DEPTH = 1;
/** Exterior half-extent minus the interior's: the shell's thickness at the door band. */
export const SHELL_INSET = 0.24;
/** Interior half-extent cap for a sized (not `exteriorSize`d) building BEFORE its width scale. With the
 *  scale (≤ 1.5 by default) it sets the spawn spacing (spec.ts `footprint`) and MAX_FOOTPRINT_REACH
 *  (objects/foliage/foliage.worker.ts). */
export const MAX_INTERIOR_HALF = 13;
/** How far a multi-story interior may grow to fit its ramp shaft (also before the width scale). */
export const MAX_GROWN_INTERIOR_HALF = 16;
export const MAX_STORIES = 6;
export const DEFAULT_WIDTH_SCALE: [number, number] = [1, 1.5];
export const DEFAULT_SIDES = [4, 5, 6, 7, 8];

/** Caps IDLE (refcount 0) entries only; retained entries never count. */
export const MAX_IDLE_CACHE = 128;

export const INITIAL_CAPACITY = 1024;
export const REBASE_DISTANCE = 2000;
