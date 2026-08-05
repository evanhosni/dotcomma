import { RingLevel } from "./types";

/**
 * Shared ring-cross-section math for exterior lofts, used by both the plan
 * generator (door facet placement) and the geometry builder (wall emission).
 * Rings are emitted so that walking the point list gives outward-facing
 * walls: rect corners clockwise-from-above, ellipses with negated sin.
 */

export type Pt2 = [number, number];

export const ringPoints = (rect: boolean, sides: number, level: RingLevel, phase = 0): Pt2[] => {
  const { cx, cz, hw, hd } = level;
  if (rect) {
    return [
      [cx + hw, cz + hd],
      [cx + hw, cz - hd],
      [cx - hw, cz - hd],
      [cx - hw, cz + hd],
    ];
  }
  const pts: Pt2[] = [];
  for (let j = 0; j < sides; j++) {
    const a = (j / sides) * Math.PI * 2 + phase;
    pts.push([cx + Math.cos(a) * hw, cz - Math.sin(a) * hd]);
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

/** True when p lies inside the (convex) ring polygon, at least `inset` from
 *  every edge. */
export const pointInRing = (pts: Pt2[], p: Pt2, inset = 0): boolean => {
  for (let j = 0; j < pts.length; j++) {
    const n = edgeNormal(pts, j);
    const d = (p[0] - pts[j][0]) * n[0] + (p[1] - pts[j][1]) * n[1];
    if (d > -inset) return false;
  }
  return true;
};

/** Largest factor f such that the axis-aligned rect with corners (±f·hw,
 *  ±f·hd) fits inside the ring polygon with `inset` clearance. */
export const inscribedRectFactor = (pts: Pt2[], hw: number, hd: number, inset = 0): number => {
  let lo = 0.05;
  let hi = 1;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const corners: Pt2[] = [
      [mid * hw, mid * hd],
      [mid * hw, -mid * hd],
      [-mid * hw, -mid * hd],
      [-mid * hw, mid * hd],
    ];
    if (corners.every((c) => pointInRing(pts, c, inset))) lo = mid;
    else hi = mid;
  }
  return lo;
};

/** Where the line `axis = at` crosses the ring polygon: the [min, max] of
 *  the other coordinate. E.g. ("x", at) → the z-range of the polygon at x=at. */
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

/** Ring cross-section at height y, lerped between the bracketing levels. */
export const interpRing = (levels: RingLevel[], y: number): RingLevel => {
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
        hw: a.hw + (b.hw - a.hw) * t,
        hd: a.hd + (b.hd - a.hd) * t,
      };
    }
  }
  return levels[levels.length - 1];
};
