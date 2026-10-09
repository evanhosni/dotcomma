import { RingLevel } from "./types";

// Walking a ring's point list gives OUTWARD-facing walls: rect corners
// clockwise-from-above, ellipses with negated sin.

export type Pt2 = [number, number];

export const ringPoints = (rect: boolean, sides: number, level: RingLevel, phase = 0): Pt2[] => {
  const { cx, cz, halfWidth, halfDepth } = level;
  if (rect) {
    return [
      [cx + halfWidth, cz + halfDepth],
      [cx + halfWidth, cz - halfDepth],
      [cx - halfWidth, cz - halfDepth],
      [cx - halfWidth, cz + halfDepth],
    ];
  }
  const pts: Pt2[] = [];
  for (let j = 0; j < sides; j++) {
    const a = (j / sides) * Math.PI * 2 + phase;
    pts.push([cx + Math.cos(a) * halfWidth, cz - Math.sin(a) * halfDepth]);
  }
  return pts;
};

/** Rect ring edge index per wall side (see ringPoints corner order). */
export const RECT_EDGE: Record<"+x" | "-z" | "-x" | "+z", number> = {
  "+x": 0,
  "-z": 1,
  "-x": 2,
  "+z": 3,
};

export const edgePoint = (pts: Pt2[], j: number, t: number): Pt2 => {
  const a = pts[j];
  const b = pts[(j + 1) % pts.length];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

/** Outward unit normal of ring edge j (in the xz plane). */
export const edgeNormal = (pts: Pt2[], j: number): Pt2 => {
  const a = pts[j];
  const b = pts[(j + 1) % pts.length];
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return [-dz / len, dx / len];
};

export const edgeLength = (pts: Pt2[], j: number): number => {
  const a = pts[j];
  const b = pts[(j + 1) % pts.length];
  return Math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2);
};

/** Inside the convex ring polygon, at least `inset` from every edge. */
export const pointInRing = (pts: Pt2[], p: Pt2, inset = 0): boolean => {
  for (let j = 0; j < pts.length; j++) {
    const n = edgeNormal(pts, j);
    const d = (p[0] - pts[j][0]) * n[0] + (p[1] - pts[j][1]) * n[1];
    if (d > -inset) return false;
  }
  return true;
};

/** Largest f such that the rect with corners (±f·halfWidth, ±f·halfDepth) fits inside the ring with `inset` clearance. */
export const inscribedRectFactor = (pts: Pt2[], halfWidth: number, halfDepth: number, inset = 0): number => {
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const corners: Pt2[] = [
      [mid * halfWidth, mid * halfDepth],
      [mid * halfWidth, -mid * halfDepth],
      [-mid * halfWidth, -mid * halfDepth],
      [-mid * halfWidth, mid * halfDepth],
    ];
    if (corners.every((c) => pointInRing(pts, c, inset))) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** [min, max] of the other coordinate where the line `axis = at` crosses the ring. */
export const ringSpanAt = (pts: Pt2[], axis: "x" | "z", at: number): [number, number] => {
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % pts.length];
    const a0 = axis === "x" ? a[0] : a[1];
    const b0 = axis === "x" ? b[0] : b[1];
    if ((a0 <= at && b0 >= at) || (b0 <= at && a0 >= at)) {
      const t = (at - a0) / (b0 - a0 || 1e-9);
      const v = axis === "x" ? a[1] + (b[1] - a[1]) * t : a[0] + (b[0] - a[0]) * t;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
};

/** Each vertex's velocity when every edge of the convex ring moves INWARD at unit speed. */
const inwardVelocities = (pts: Pt2[]): Pt2[] =>
  pts.map((_, i) => {
    const a = edgeNormal(pts, (i - 1 + pts.length) % pts.length); // outward normals of the edges meeting here
    const b = edgeNormal(pts, i);
    const det = a[0] * b[1] - a[1] * b[0]; // v·(−a) = v·(−b) = 1
    return Math.abs(det) < 1e-12 ? [0, 0] : [(a[1] - b[1]) / det, (b[0] - a[0]) / det];
  });

/** The convex ring with every edge moved `d` inward (negative: outward), corners kept sharp. */
export const offsetRing = (pts: Pt2[], d: number): Pt2[] => {
  const v = inwardVelocities(pts);
  return pts.map((p, i) => [p[0] + v[i][0] * d, p[1] + v[i][1] * d]);
};

/** The straight skeleton of a CONVEX ring, as the ring shrinking with every edge moving inward at
 *  unit speed, snapshotted at each event (an edge collapsing). Every snapshot keeps the input's point
 *  count, so ring j → j+1 between snapshots traces exactly edge j's face, and a face lofted at
 *  height ∝ offset is planar: a hip roof at one pitch. Ends on the ridge (two points left) or the peak. */
export const hipRoofRings = (pts: Pt2[]): { rings: Pt2[][]; offsets: number[] } => {
  let active = pts.map((p, i) => ({ p: [p[0], p[1]] as Pt2, members: [i] }));
  const snapshot = (): Pt2[] => {
    const ring: Pt2[] = new Array(pts.length);
    for (const v of active) for (const m of v.members) ring[m] = [v.p[0], v.p[1]];
    return ring;
  };
  const rings = [snapshot()];
  const offsets = [0];
  let offset = 0;
  for (let guard = 0; active.length >= 3 && guard < pts.length; guard++) {
    const ps = active.map((v) => v.p);
    const vel = inwardVelocities(ps);
    const collapseAt = ps.map((_, i) => {
      const j = (i + 1) % ps.length;
      const L = edgeLength(ps, i);
      const closing = ((vel[i][0] - vel[j][0]) * (ps[j][0] - ps[i][0]) + (vel[i][1] - vel[j][1]) * (ps[j][1] - ps[i][1])) / (L || 1);
      return closing > 1e-9 ? L / closing : Infinity;
    });
    const dt = Math.min(...collapseAt);
    if (!Number.isFinite(dt)) break;
    active.forEach((v, i) => (v.p = [v.p[0] + vel[i][0] * dt, v.p[1] + vel[i][1] * dt]));
    offset += dt;
    // Edges collapsing together (a rectangle's two ends, a triangle's three) merge in one event.
    const collapsed = collapseAt.map((t) => t - dt <= 1e-6 * (1 + dt));
    const n = active.length;
    const start = collapsed.findIndex((_, i) => !collapsed[(i - 1 + n) % n]);
    if (start < 0) {
      const apex = active[0].p;
      active = [{ p: apex, members: active.flatMap((v) => v.members) }];
    } else {
      const merged: typeof active = [];
      for (let k = 0; k < n; k++) {
        const i = (start + k) % n;
        if (k > 0 && collapsed[(i - 1 + n) % n]) merged[merged.length - 1].members.push(...active[i].members);
        else merged.push({ p: active[i].p, members: [...active[i].members] });
      }
      active = merged;
    }
    rings.push(snapshot());
    offsets.push(offset);
  }
  return { rings, offsets };
};

export const interpRing =(levels: RingLevel[], y: number): RingLevel => {
  if (y <= levels[0].y) return levels[0];
  for (let i = 0; i < levels.length - 1; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (y <= b.y) {
      const t = (y - a.y) / (b.y - a.y || 1e-6);
      return {
        y,
        cx: a.cx + (b.cx - a.cx) * t,
        cz: a.cz + (b.cz - a.cz) * t,
        halfWidth: a.halfWidth + (b.halfWidth - a.halfWidth) * t,
        halfDepth: a.halfDepth + (b.halfDepth - a.halfDepth) * t,
      };
    }
  }
  return levels[levels.length - 1];
};
