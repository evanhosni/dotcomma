/** Polyline and segment geometry the bridge enumerator shares (world or warped xz). */

import { distanceToSegment } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { BRIDGE_WET_SAMPLE, MOUTH_SAMPLE } from "./constants";

/** Corners of a deck's path sharper than this are rounded, with arcs up to this radius. */
const BRIDGE_FILLET_MIN_TURN = (12 * Math.PI) / 180;
const BRIDGE_FILLET_RADIUS = 120;
const BRIDGE_FILLET_COARSE = 5;
const BRIDGE_FILLET_END_KEEP = 12;

/** Distance between two segments (0 when they cross). */
export const segSegDistance = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number => {
  const cross = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = cross(ax, az, bx, bz, cx, cz);
  const d2 = cross(ax, az, bx, bz, dx, dz);
  const d3 = cross(cx, cz, dx, dz, ax, az);
  const d4 = cross(cx, cz, dx, dz, bx, bz);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    distanceToSegment(ax, az, cx, cz, dx, dz),
    distanceToSegment(bx, bz, cx, cz, dx, dz),
    distanceToSegment(cx, cz, ax, az, bx, bz),
    distanceToSegment(dx, dz, ax, az, bx, bz),
  );
};

/** Merged [lo, hi] intervals. */
export const mergeIntervals = (list: number[][]): number[][] => {
  list.sort((a, b) => a[0] - b[0]);
  const out: number[][] = [];
  for (const iv of list) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
};

/** Rounds every corner of a deck's path with the widest arc its legs allow (≤ BRIDGE_FILLET_RADIUS):
 *  a road rounding a corner over the water — a belt at a city wall's junction — would draw a V-kinked
 *  deck. Only the deck bends: the corner itself lies in the river's footprint, where
 *  the terrain shows no road. The path's end legs keep their direction, so the ends stay square to
 *  the road they land on. */
export const filletCorners = (path: PointXZ[]): PointXZ[] => {
  if (path.length < 3) return path;
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z));
  const L = cum[cum.length - 1];
  // The corners, found on a coarse view of the path (a fine one splits a corner over short legs).
  const coarse = simplifyPolyline(
    path.map((p) => p.x),
    path.map((p) => p.z),
    BRIDGE_FILLET_COARSE,
  );
  const corners: { s: number; turn: number }[] = [];
  for (let k = 1; k + 1 < coarse.length; k++) {
    const a = path[coarse[k - 1]];
    const p = path[coarse[k]];
    const b = path[coarse[k + 1]];
    const l0 = Math.hypot(p.x - a.x, p.z - a.z) || 1;
    const l1 = Math.hypot(b.x - p.x, b.z - p.z) || 1;
    const turn = Math.acos(Math.max(-1, Math.min(1, ((p.x - a.x) * (b.x - p.x) + (p.z - a.z) * (b.z - p.z)) / (l0 * l1))));
    if (turn >= BRIDGE_FILLET_MIN_TURN) corners.push({ s: cum[coarse[k]], turn });
  }
  if (corners.length === 0) return path;
  // Each corner's reach along the path: its arc's tangent length, at most 45% of the way to the
  // next corner, and short of either end by BRIDGE_FILLET_END_KEEP (the end legs keep their direction).
  const spans = corners.map((c, i) => {
    const prev = i > 0 ? 0.45 * (c.s - corners[i - 1].s) : c.s - BRIDGE_FILLET_END_KEEP;
    const next = i + 1 < corners.length ? 0.45 * (corners[i + 1].s - c.s) : L - c.s - BRIDGE_FILLET_END_KEEP;
    const t = Math.max(0, Math.min(BRIDGE_FILLET_RADIUS * Math.tan(c.turn / 2), prev, next));
    return [c.s - t, c.s + t];
  });
  const at = (s: number) => polyPointAt(path, cum, s);
  const dirAtS = (s: number) => polyDirAt(path, cum, s);
  const out: PointXZ[] = [];
  let span = 0;
  for (let i = 0; i < path.length; i++) {
    while (span < spans.length && cum[i] > spans[span][0]) {
      // A cubic Hermite from the span's start to its end, tangent to the road at both.
      const [s0, s1] = spans[span];
      const p0 = at(s0);
      const p1 = at(s1);
      const d0 = dirAtS(Math.max(0, s0 - 1e-6));
      const d1 = dirAtS(Math.min(L, s1 + 1e-6));
      const k = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      const steps = Math.max(2, Math.ceil((s1 - s0) / BRIDGE_WET_SAMPLE));
      for (let j = 0; j <= steps; j++) {
        const u = j / steps;
        const h00 = 2 * u * u * u - 3 * u * u + 1;
        const h10 = u * u * u - 2 * u * u + u;
        const h01 = -2 * u * u * u + 3 * u * u;
        const h11 = u * u * u - u * u;
        out.push({ x: h00 * p0.x + h10 * k * d0.x + h01 * p1.x + h11 * k * d1.x, z: h00 * p0.z + h10 * k * d0.z + h01 * p1.z + h11 * k * d1.z });
      }
      while (i < path.length && cum[i] <= s1) i++;
      span++;
    }
    if (i < path.length) out.push(path[i]);
  }
  return out;
};

/** No leg shorter than BRIDGE_MIN_LEG (an arc's end lands beside the road's next vertex, an end
 *  point beside the first sample): a stub leg turns the miter sharply over nothing and bow-ties
 *  the slab (bridgeSections). The ends stay. */
export const dropShortLegs = (path: PointXZ[]): PointXZ[] => {
  const out: PointXZ[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const last = out[out.length - 1];
    const short = Math.hypot(path[i].x - last.x, path[i].z - last.z) < BRIDGE_MIN_LEG;
    if (i < path.length - 1) {
      if (!short) out.push(path[i]);
      continue;
    }
    if (short && out.length > 1) out.pop();
    out.push(path[i]);
  }
  return out;
};

/** Douglas–Peucker: indices kept so no dropped point is farther than `tol` from the chord. */
export const simplifyPolyline = (x: number[], z: number[], tol: number): number[] => {
  const keep = new Uint8Array(x.length);
  keep[0] = keep[x.length - 1] = 1;
  const stack: [number, number][] = [[0, x.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(x[i], z[i], x[a], z[a], x[b], z[b]);
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < x.length; i++) if (keep[i]) out.push(i);
  return out;
};

export const polyPointAt = (path: PointXZ[], cum: number[], s: number): PointXZ => {
  if (s <= 0) return path[0];
  for (let i = 1; i < path.length; i++) {
    if (s <= cum[i] || i === path.length - 1) {
      const t = Math.min(1, (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]));
      return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * t, z: path[i - 1].z + (path[i].z - path[i - 1].z) * t };
    }
  }
  return path[path.length - 1];
};

export const polyDirAt = (path: PointXZ[], cum: number[], s: number): PointXZ => {
  let i = 1;
  while (i < path.length - 1 && cum[i] < s) i++;
  const dx = path[i].x - path[i - 1].x;
  const dz = path[i].z - path[i - 1].z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
};

/** Arc position of the point of a polyline nearest to p, and the distance. */
export const projectOnPolyline = (xs: number[], zs: number[], px: number, pz: number): { s: number; d: number } => {
  let best = Infinity;
  let bestS = 0;
  let acc = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const dx = xs[i + 1] - xs[i];
    const dz = zs[i + 1] - zs[i];
    const l2 = dx * dx + dz * dz;
    const l = Math.sqrt(l2);
    let t = l2 > 0 ? ((px - xs[i]) * dx + (pz - zs[i]) * dz) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const d = Math.hypot(px - (xs[i] + dx * t), pz - (zs[i] + dz * t));
    if (d < best) {
      best = d;
      bestS = acc + t * l;
    }
    acc += l;
  }
  return { s: bestS, d: best };
};

/** A deck's path keeps no leg shorter than this. */
const BRIDGE_MIN_LEG = 3;

/** Segment intersection point of a→b and c→d, or null. */
export const segIntersect = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): PointXZ | null => {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sz - (cz - az) * sx) / den;
  const u = ((cx - ax) * rz - (cz - az) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + rx * t, z: az + rz * t };
};

/** A cubic Hermite from a (leaving along ad) to b (arriving along bd), tangents k long, sampled
 *  every MOUTH_SAMPLE or so. */
export const hermitePoints = (a: PointXZ, ad: PointXZ, b: PointXZ, bd: PointXZ, k: number): PointXZ[] => {
  const L = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(4, Math.ceil((L * 1.2) / MOUTH_SAMPLE));
  const pts: PointXZ[] = [];
  for (let j = 0; j <= steps; j++) {
    const u = j / steps;
    const h00 = 2 * u * u * u - 3 * u * u + 1;
    const h10 = u * u * u - 2 * u * u + u;
    const h01 = -2 * u * u * u + 3 * u * u;
    const h11 = u * u * u - u * u;
    pts.push({ x: h00 * a.x + h10 * k * ad.x + h01 * b.x + h11 * k * bd.x, z: h00 * a.z + h10 * k * ad.z + h01 * b.z + h11 * k * bd.z });
  }
  return pts;
};

/** Closest approach of two polylines. */
export const polylinesApart = (a: PointXZ[], b: PointXZ[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) {
    for (let j = 0; j + 1 < b.length; j++) {
      best = Math.min(best, segSegDistance(a[i].x, a[i].z, a[i + 1].x, a[i + 1].z, b[j].x, b[j].z, b[j + 1].x, b[j + 1].z));
    }
  }
  return best;
};
