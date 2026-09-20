/**
 * SNAPSHOT INTERPOLATION (see CLAUDE.md → Entity sync). The entity is drawn as
 * it was INTERP_DELAY_MS ago on the SERVER clock, between the two bracketing
 * snapshots — message ARRIVAL time plays no part. Arrival-time extrapolation was
 * REJECTED: under real browser load messages arrive in bursts, so it overshot
 * stops, slid back and lurched after every hitch (unreproducible headlessly).
 */

export interface Snapshot {
  /** Server time (ms) of the publishing tick. */
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

export type SampleStatus = "none" | "hold" | "interpolated" | "extrapolated";

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

const wrapAngle = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/** Older samples are dropped; the same `st` REPLACES (one tick's fields can arrive in two messages). */
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

/** Always keeps at least two. */
export const pruneSnapshots = (snaps: Snapshot[], renderTime: number): void => {
  let drop = 0;
  while (snaps.length - drop > 2 && snaps[drop + 1].st < renderTime - SNAPSHOT_KEEP_MS) drop++;
  if (drop) snaps.splice(0, drop);
};

/** "none" leaves `out` untouched. */
export const sampleSnapshots = (snaps: Snapshot[], renderTime: number, out: SampledPose): SampleStatus => {
  const n = snaps.length;
  if (n === 0) return "none";
  let i = n - 1;
  while (i >= 0 && snaps[i].st > renderTime) i--;
  if (i < 0) {
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
    const dt = Math.min(renderTime - a.st, MAX_EXTRAPOLATION_MS) / 1000;
    out.x = a.x + a.vx * dt;
    out.y = a.y + a.vy * dt;
    out.z = a.z + a.vz * dt;
    out.ry = a.ry;
    const moving = dt > 0 && renderTime - a.st <= MAX_EXTRAPOLATION_MS;
    out.vx = moving ? a.vx : 0;
    out.vy = moving ? a.vy : 0;
    out.vz = moving ? a.vz : 0;
    return renderTime - a.st <= MAX_EXTRAPOLATION_MS ? "extrapolated" : "hold";
  }
  const b = snaps[i + 1];
  let span = b.st - a.st;
  const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  // An idle gap (nothing is published while an entity rests) = "stood at `a`
  // until one interval before `b`", not a creep across the gap. MEASURED: lerping
  // across it hopped ~0.5u the frame the first moving snapshot arrived.
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
  return "interpolated";
};

/** ±10%: a re-estimated clock offset (a better-RTT pong) never steps the picture. */
export const RENDER_CLOCK_MAX_SLEW = 0.1;
/** Beyond this far off, the render clock jumps instead of slewing. */
export const RENDER_CLOCK_SNAP_MS = 500;

export const advanceRenderClock = (clock: number, dtMs: number, target: number): number => {
  if (!Number.isFinite(clock) || Math.abs(target - clock) > RENDER_CLOCK_SNAP_MS) return target;
  const err = target - (clock + dtMs);
  const slew = Math.max(-RENDER_CLOCK_MAX_SLEW, Math.min(RENDER_CLOCK_MAX_SLEW, err / 200));
  return clock + dtMs * (1 + slew);
};
