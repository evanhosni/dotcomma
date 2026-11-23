

/** Camera far plane, world units. The outermost terrain LOD ring (world/terrain/lod/constants.ts) reaches
 *  exactly this far, and the ground's far fade ends here (world/shaders/material.ts). */
export const CAMERA_FAR = 7200;

/** Radians the look stops short of straight up or down: 89.9° of pitch each way. */
export const CAMERA_PITCH_MARGIN = (0.1 * Math.PI) / 180;

/** A worker sample older than this is given up on (lost to a worker reset). */
export const SAMPLE_GIVE_UP_MS = 1000;
