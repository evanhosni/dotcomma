/** Horizontal path shapes for the cave generator: smooth curves through control points, sampled at a
 *  fixed step. Three-free. */

import type { PointXZ } from "../../math/types";

/** Catmull-Rom through `points` (closed: back to the first), sampled every `step` units of arc. The
 *  first point is always a sample; an open curve ends exactly on its last point. */
export const sampleCurve = (points: readonly PointXZ[], closed: boolean, step: number): PointXZ[] => {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [{ x: points[0].x, z: points[0].z }];
  const at = (i: number): PointXZ => (closed ? points[((i % n) + n) % n] : points[i < 0 ? 0 : i >= n ? n - 1 : i]);
  const segments = closed ? n : n - 1;
  // Dense polyline first, then resampled by arc length.
  const dense: PointXZ[] = [];
  for (let s = 0; s < segments; s++) {
    const p0 = at(s - 1);
    const p1 = at(s);
    const p2 = at(s + 1);
    const p3 = at(s + 2);
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const sub = Math.max(2, Math.ceil(len / (step / 4)));
    for (let k = 0; k < sub; k++) {
      const t = k / sub;
      const t2 = t * t;
      const t3 = t2 * t;
      dense.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        z: 0.5 * (2 * p1.z + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
      });
    }
  }
  dense.push(closed ? { x: points[0].x, z: points[0].z } : { x: points[n - 1].x, z: points[n - 1].z });
  const out: PointXZ[] = [{ x: dense[0].x, z: dense[0].z }];
  let carried = 0;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    let along = step - carried;
    while (along <= len) {
      const t = along / len;
      out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      along += step;
    }
    carried = len - (along - step);
  }
  const last = dense[dense.length - 1];
  const end = out[out.length - 1];
  if (Math.hypot(last.x - end.x, last.z - end.z) > step * 0.25) out.push({ x: last.x, z: last.z });
  else {
    end.x = last.x;
    end.z = last.z;
  }
  return out;
};

/** Unit direction of travel at sample `i` of a polyline (central where it can be). */
export const tangentAt = (samples: readonly PointXZ[], i: number, closed = false): PointXZ => {
  const n = samples.length;
  if (n < 2) return { x: 1, z: 0 };
  const prev = closed ? samples[(i - 1 + n) % n] : samples[Math.max(0, i - 1)];
  const next = closed ? samples[(i + 1) % n] : samples[Math.min(n - 1, i + 1)];
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
};

/** A direction turned by `angle` (radians, counter-clockwise seen from above with x right, z down). */
export const rotated = (d: PointXZ, angle: number): PointXZ => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: d.x * c - d.z * s, z: d.x * s + d.z * c };
};

/** The left-hand perpendicular of a direction. */
export const perpendicular = (d: PointXZ): PointXZ => ({ x: -d.z, z: d.x });
