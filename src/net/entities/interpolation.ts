/**
 * SNAPSHOT INTERPOLATION — how a synced actor's published track becomes a
 * drawn pose. Pure functions, no Three/React (unit-tested in
 * interpolation.test.ts).
 *
 * The server publishes each moving entity at TICK_HZ with the server time of
 * the tick (`st`). The client keeps the last few snapshots and draws the
 * entity as it was INTERP_DELAY_MS ago on the SERVER clock — so at any render
 * time there are (almost always) two snapshots to interpolate between and the
 * drawn motion is exactly the server's track, delayed. Nothing depends on
 * WHEN a message arrived: a main-thread hitch or two packets arriving
 * together change nothing (the samples still carry their own times), the
 * entity stops exactly where and when the server stopped it, and the
 * animation — started from `clipT0` on the same delayed clock — lines up.
 *
 * This REPLACED arrival-time extrapolation (draw = last position + velocity ×
 * time since the message ARRIVED, eased toward): under load the browser
 * processes messages in bursts, so that design overshot stops and then slid
 * back, and lurched forward to catch up after every hitch — the "sliding" and
 * "teleporting a bit" reports. It could not be reproduced headlessly because
 * a headless client has no hitches.
 *
 * Past the newest snapshot (a late packet) the pose extrapolates from that
 * snapshot's velocity for at most MAX_EXTRAPOLATION_MS, then HOLDS. Two
 * consecutive snapshots farther apart than TELEPORT_DIST are a genuine server
 * relocation (respawn, restart) and are not interpolated across.
 */

export interface Snapshot {
  /** Server time (ms) of the tick that published this pose. */
  st: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SampledPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Velocity of the segment being played back (u/s). */
  vx: number;
  vy: number;
  vz: number;
}

export type SampleStatus = "none" | "hold" | "interp" | "extrap";

/** The server's publish interval for a moving entity (TICK_HZ = 10). */
export const PUBLISH_INTERVAL_MS = 100;
/** How far behind the server clock the picture runs: two ticks, so the
 *  snapshot that ends the segment being drawn has normally arrived even with
 *  tick jitter and a late packet. Imperceptible for NPCs; every client sees
 *  the same delayed track. */
export const INTERP_DELAY_MS = 200;
/** Past the newest snapshot, extrapolate this long, then hold. */
export const MAX_EXTRAPOLATION_MS = 250;
/** Consecutive snapshots farther apart than this are a relocation: no lerp. */
export const TELEPORT_DIST = 40;
/** Snapshots older than this behind the render time are dropped (keep ≥ 2). */
export const SNAPSHOT_KEEP_MS = 1000;
export const MAX_SNAPSHOTS = 32;

const wrapAngle = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Append a snapshot in time order (out-of-order older samples are dropped;
 *  a sample with the same `st` REPLACES the previous one — the same tick's
 *  fields arriving in two messages). */
export const pushSnapshot = (snaps: Snapshot[], s: Snapshot): void => {
  const last = snaps[snaps.length - 1];
  if (last) {
    if (s.st < last.st) return;
    if (s.st === last.st) {
      snaps[snaps.length - 1] = s;
      return;
    }
  }
  snaps.push(s);
  if (snaps.length > MAX_SNAPSHOTS) snaps.splice(0, snaps.length - MAX_SNAPSHOTS);
};

/** Drop history the render time has left behind, always keeping two. */
export const pruneSnapshots = (snaps: Snapshot[], renderTime: number): void => {
  let drop = 0;
  while (snaps.length - drop > 2 && snaps[drop + 1].st < renderTime - SNAPSHOT_KEEP_MS) drop++;
  if (drop) snaps.splice(0, drop);
};

/**
 * The pose at `renderTime` (server clock). Returns what kind of sample it was;
 * "none" leaves `out` untouched.
 */
export const sampleSnapshots = (snaps: Snapshot[], renderTime: number, out: SampledPose): SampleStatus => {
  const n = snaps.length;
  if (n === 0) return "none";
  // Newest sample at or before renderTime.
  let i = n - 1;
  while (i >= 0 && snaps[i].st > renderTime) i--;
  if (i < 0) {
    // Render time is before everything we know: hold the oldest.
    const a = snaps[0];
    out.x = a.x;
    out.y = a.y;
    out.z = a.z;
    out.ry = a.ry;
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    return "hold";
  }
  const a = snaps[i];
  if (i === n - 1) {
    // Past the newest: extrapolate briefly with its velocity, then hold.
    const dt = Math.min(renderTime - a.st, MAX_EXTRAPOLATION_MS) / 1000;
    out.x = a.x + a.vx * dt;
    out.y = a.y + a.vy * dt;
    out.z = a.z + a.vz * dt;
    out.ry = a.ry;
    const moving = dt > 0 && renderTime - a.st <= MAX_EXTRAPOLATION_MS;
    out.vx = moving ? a.vx : 0;
    out.vy = moving ? a.vy : 0;
    out.vz = moving ? a.vz : 0;
    return renderTime - a.st <= MAX_EXTRAPOLATION_MS ? "extrap" : "hold";
  }
  const b = snaps[i + 1];
  let span = b.st - a.st;
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  // A GAP: the server publishes nothing while an entity rests, so a segment
  // much longer than the publish interval means "stood at `a` until one
  // publish interval before `b`, then moved" — not a slow creep across the
  // whole idle time. (Measured: without this, a beeble starting to walk after
  // idling hopped ~0.5u the frame its first moving snapshot arrived, because
  // the render clock was already at the end of the idle-spanning segment.)
  let aSt = a.st;
  if (span > 2 * PUBLISH_INTERVAL_MS) {
    aSt = b.st - PUBLISH_INTERVAL_MS;
    span = PUBLISH_INTERVAL_MS;
    if (renderTime < aSt) {
      out.x = a.x;
      out.y = a.y;
      out.z = a.z;
      out.ry = a.ry;
      out.vx = 0;
      out.vy = 0;
      out.vz = 0;
      return "hold";
    }
  }
  if (span <= 0 || dist > TELEPORT_DIST) {
    // A relocation: sit on `a` until its time is up, then appear at `b`.
    const s = renderTime >= b.st ? b : a;
    out.x = s.x;
    out.y = s.y;
    out.z = s.z;
    out.ry = s.ry;
    out.vx = 0;
    out.vy = 0;
    out.vz = 0;
    return "hold";
  }
  const f = (renderTime - aSt) / span;
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.z = a.z + (b.z - a.z) * f;
  out.ry = a.ry + wrapAngle(b.ry - a.ry) * f;
  const inv = 1000 / span;
  out.vx = (b.x - a.x) * inv;
  out.vy = (b.y - a.y) * inv;
  out.vz = (b.z - a.z) * inv;
  return "interp";
};

/** Max rate the render clock may run fast/slow to converge on its target. */
export const RENDER_CLOCK_MAX_SLEW = 0.1;
/** Beyond this far off, the render clock jumps instead of slewing. */
export const RENDER_CLOCK_SNAP_MS = 500;

/**
 * Advance a per-actor render clock by a frame. It converges on `target`
 * (server time − INTERP_DELAY_MS) by running at most ±10% fast or slow, so a
 * re-estimated clock offset (a pong with a better RTT) never steps the
 * picture; only a gross error snaps.
 */
export const advanceRenderClock = (clock: number, dtMs: number, target: number): number => {
  if (!Number.isFinite(clock) || Math.abs(target - clock) > RENDER_CLOCK_SNAP_MS) return target;
  const err = target - (clock + dtMs);
  const slew = Math.max(-RENDER_CLOCK_MAX_SLEW, Math.min(RENDER_CLOCK_MAX_SLEW, err / 200));
  return clock + dtMs * (1 + slew);
};
