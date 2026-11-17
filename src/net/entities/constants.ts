/** Server TICK_HZ = 10. */
export const PUBLISH_INTERVAL_MS = 100;
/** Two ticks: the snapshot ending the drawn segment has normally arrived even
 *  with tick jitter and a late packet. */
export const INTERP_DELAY_MS = 200;
/** Past the newest snapshot, extrapolate this long, then hold. */
export const MAX_EXTRAPOLATION_MS = 250;
/** Consecutive snapshots farther apart than this are a relocation: no lerp. */
export const TELEPORT_DIST = 40;
export const SNAPSHOT_KEEP_MS = 1000;
export const MAX_SNAPSHOTS = 32;

/** ±10%: a re-estimated clock offset (a better-RTT pong) never steps the picture. */
export const RENDER_CLOCK_MAX_SLEW = 0.1;
/** Beyond this far off, the render clock jumps instead of slewing. */
export const RENDER_CLOCK_SNAP_MS = 500;
