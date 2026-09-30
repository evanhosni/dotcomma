/** A deck's shape as every consumer lofts it (the ribbon, the client and server colliders, the ground
 *  cut): its height line with the ramps and the arch, its stations and cross-sections, the crotch
 *  fillets at T ends, and the parapet and paint queries. */

import { smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { BRIDGE_PARAPET_WIDTH, BRIDGE_RAMP_LENGTH, BRIDGE_RAMP_SHARE } from "./constants";
import { projectOnPolyline } from "./polyline";
import type { BridgeSection, BridgeTrimAxis, FreewayBridge } from "./types";

export const bridgeRampLength = (b: FreewayBridge): number => {
  const [t0, t1] = bridgeTrimRange(b);
  return Math.min(BRIDGE_RAMP_LENGTH, BRIDGE_RAMP_SHARE * (t1 - t0) * b.length);
};

/** A landed end's ramp length (0 when the end is not landed). */
export const bridgeRampSpan = (b: FreewayBridge, which: 0 | 1): number => b.landings?.[which]?.ramp ?? 0;

/** The ramp at arc fraction t: the offset added to the deck top at the centerline, the lateral
 *  rise per unit, and the fraction of the parapet standing (0 at a landed end — the walls rise
 *  out of the ground with the deck). Blended in quadratically, so the deck meets its own line
 *  tangentially BRIDGE_RAMP_LENGTH from the end. Ribbon, client and server colliders all read it. */
export const bridgeRampAt = (b: FreewayBridge, t: number): { dy: number; slope: number; wall: number } => {
  let dy = 0;
  let slope = 0;
  let wall = 1;
  if (!b.landings) return { dy, slope, wall };
  const [t0, t1] = bridgeTrimRange(b);
  const R = bridgeRampLength(b);
  for (const which of [0, 1] as const) {
    const land = b.landings[which];
    if (!land) continue;
    const d = Math.max(0, (which === 0 ? t - t0 : t1 - t) * b.length);
    wall = Math.min(wall, smoothstep(0, R, d));
    if (d >= land.ramp) continue;
    const u = 1 - d / land.ramp;
    dy += land.drop * u * u;
    slope += land.slope * u * u;
  }
  return { dy, slope, wall };
};

/** Deck-top height at arc fraction t along the centerline, before the landed ends' ramps (the
 *  ribbon, the colliders and the T-joins add bridgeRampAt; the T-joins and piers read this). */
export const bridgeDeckY = (b: FreewayBridge, t: number): number => {
  // The arch spans the drawn range: 0 at a T end, where the deck meets its host at the host's height.
  const from = (b.trimStart ?? 0) / b.length;
  const span = 1 - (b.trimEnd ?? 0) / b.length - from;
  return b.sy + (b.ey - b.sy) * t + b.camber * bridgeArchShape((t - from) / span);
};

/** The arch's shape over its span (u 0–1 over the drawn range): the parabola, 1 at the middle. */
export const bridgeArchShape = (u: number): number => 4 * u * (1 - u);

/** Longest collider chord / ribbon station spacing: short enough that an arch reads as a curve. */
const BRIDGE_SEGMENT_LENGTH = 6;
/** The square section beside a T end's cut stands this far past the cut's farthest corner. */
const BRIDGE_SWEEP_CLEAR = 0.5;

/** Arc fractions the deck actually spans once its T ends are trimmed to their hosts' slab edges. */
export const bridgeTrimRange = (b: FreewayBridge): [number, number] => [(b.trimStart ?? 0) / b.length, 1 - (b.trimEnd ?? 0) / b.length];

/** Whether a world point beside the deck (its projection at arc fraction t) lies within its drawn
 *  length: between its two end sections — an oblique cut (a T end's, a landed end's along the road's
 *  edge) by the side of its cut line, a square end by t alone. */
export const bridgeWithinEnds = (b: FreewayBridge, x: number, z: number, t: number): boolean => {
  const [t0, t1] = bridgeTrimRange(b);
  for (const which of [0, 1] as const) {
    const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
    const tEnd = which === 0 ? t0 : t1;
    if (!axis) {
      if (which === 0 ? t < t0 : t > t1) return false;
      continue;
    }
    const sweep = bridgeTrimSweep(b, which);
    if (which === 0 ? t < t0 - sweep : t > t1 + sweep) return false;
    const c = pointAt(b, tEnd);
    // Travel direction from the axis (+ = left of travel): inward from this end.
    const l = Math.hypot(axis.x, axis.z) || 1;
    const inward = which === 0 ? 1 : -1;
    if (((x - c.x) * (axis.z / l) + (z - c.z) * (-axis.x / l)) * inward < 0) return false;
  }
  return true;
};

/** Whether the parapet on `side` (+1 = left of travel) stands at arc fraction t: another deck's
 *  footprint (a T-child's mouth, an overlapping deck) opens it. */
export const bridgeParapetAt = (b: FreewayBridge, t: number, side: 1 | -1): boolean => !(b.gaps ?? []).some((g) => g.side === side && t > g.t0 && t < g.t1);

/** Whether the deck carries lane paint at arc fraction t. */
export const bridgePaintAt = (b: FreewayBridge, t: number): boolean => !b.paint.off.some(([t0, t1]) => t > t0 && t < t1);

/** The lane dashes' period in phase units: a dash while `mod(phase, period)` is under half of it (the
 *  city fragment shader and the deck material both hard-code 10). */
export const LANE_DASH_PERIOD = 10;

/** The lane-dash phase at arc fraction t: the terrain road's own at each landed end, continued along
 *  the deck at that road's own rate. Between two painted ends the rate eases from one end's to the
 *  other's and the phases only have to agree modulo a period: end 1's is run the way end 0's runs (a
 *  reversed dash pattern is the same pattern half a period on), and what is left over after whole
 *  periods — at most half of one — is spread over the deck. Blending the raw phases squeezed their
 *  difference — thousands of units where the ends land on different roads — into the deck's length,
 *  a dash every few decimetres (MEASURED: up to 60× the road's rate). */
export const bridgeLaneAlong = (b: FreewayBridge, t: number): number => {
  const p = b.paint;
  const L = b.length;
  const s = t * L;
  if (!(p.has0 && p.has1)) return p.has0 ? p.a0 - p.r0 * s : p.has1 ? p.a1 + p.r1 * (s - L) : s;
  const reversed = p.r0 * p.r1 > 0;
  const d0 = -p.r0;
  const d1 = reversed ? -p.r1 : p.r1;
  const a1 = reversed ? LANE_DASH_PERIOD / 2 - p.a1 : p.a1;
  const eased = p.a0 + ((d0 + d1) / 2) * L;
  const rest = a1 - eased - Math.round((a1 - eased) / LANE_DASH_PERIOD) * LANE_DASH_PERIOD;
  return p.a0 + d0 * s + ((d1 - d0) * s * s) / (2 * L) + (rest * s) / L;
};

export const pointAt = (b: FreewayBridge, t: number): { x: number; z: number } => {
  const p = b.path;
  if (t <= p[0].t) return p[0];
  for (let i = 1; i < p.length; i++) {
    if (t <= p[i].t || i === p.length - 1) {
      const u = Math.min(1, (t - p[i - 1].t) / Math.max(1e-12, p[i].t - p[i - 1].t));
      return { x: p[i - 1].x + (p[i].x - p[i - 1].x) * u, z: p[i - 1].z + (p[i].z - p[i - 1].z) * u };
    }
  }
  return p[p.length - 1];
};

/** Unit travel direction of the path leg holding t (the first/last leg at the ends). */
const dirAt = (b: FreewayBridge, t: number): { x: number; z: number } => {
  const p = b.path;
  let i = 1;
  while (i < p.length - 1 && p[i].t < t) i++;
  const dx = p[i].x - p[i - 1].x;
  const dz = p[i].z - p[i - 1].z;
  const l = Math.hypot(dx, dz) || 1;
  return { x: dx / l, z: dz / l };
};

/** Arc fraction swept by a trimmed end's oblique cut: from its section's nearest to its farthest
 *  corner along the deck (the cut is along the host's edge, W/2 either side of the centerline). */
const bridgeTrimSweep = (b: FreewayBridge, which: 0 | 1): number => {
  const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
  if (!axis) return 0;
  const d = dirAt(b, which === 0 ? 0 : 1);
  return (Math.abs(axis.x * d.x + axis.z * d.z) * b.width) / 2 / b.length;
};

/** The lateral axis at arc fraction t, interpolated between the path vertices' miters. */
export const axisAt = (b: FreewayBridge, miters: { x: number; z: number }[], t: number): { x: number; z: number } => {
  const p = b.path;
  let k = 0;
  while (k < p.length - 2 && p[k + 1].t < t) k++;
  const u = Math.max(0, Math.min(1, (t - p[k].t) / Math.max(1e-12, p[k + 1].t - p[k].t)));
  return { x: miters[k].x + (miters[k + 1].x - miters[k].x) * u, z: miters[k].z + (miters[k + 1].z - miters[k].z) * u };
};

/** Where the first SQUARE section beside a T end's oblique cut stands (arc fraction): just past the
 *  cut's farthest corner, so both slab edges advance from it to the cut — found against the real
 *  axes (the path may bend inside the sweep), BRIDGE_SWEEP_CLEAR to spare. The trimmed end itself
 *  when the end is not a T end. */
/** Whether the one quad from an oblique cut (center c, axis ca) to a square section (p, axis pa) FOLDS
 *  over itself: its lateral lines rotate so fast that two of them cross inside it, where the ribbon's
 *  triangles overlapped and a point had two tops (MEASURED: 1.14 and 1.40 at one corner of an oblique
 *  landed cut). The bilinear map's Jacobian is linear in each parameter, so it is positive everywhere
 *  when it is at the four corners — here with a margin. `inward` +1 when the cut starts the deck. */
const BRIDGE_SWEEP_FOLD = 0.3;
const sweepFolds = (c: PointXZ, ca: BridgeTrimAxis, p: PointXZ, pa: PointXZ, inward: number, half: number): boolean => {
  // Parameterized from the cut (u = 0) to the square section (u = 1).
  const Ax = p.x - c.x;
  const Az = p.z - c.z;
  const Bx = pa.x - ca.x;
  const Bz = pa.z - ca.z;
  const len = Math.hypot(Ax, Az);
  const al = Math.hypot(ca.x, ca.z);
  for (const u of [0, 1]) {
    for (const l of [-half, half]) {
      const jux = Ax + Bx * l;
      const juz = Az + Bz * l;
      const jlx = ca.x + Bx * u;
      const jlz = ca.z + Bz * u;
      // (Travel runs along +u from the start's cut, −u toward the end's; the lateral axis is left of travel.)
      if ((jux * jlz - juz * jlx) * inward < BRIDGE_SWEEP_FOLD * len * al) return true;
    }
  }
  return false;
};
/** Whether the ribbon's two triangles of the quad from a cut (center c, axis ca) to a square section
 *  (p, axis pa) both face up, with some area: its four corners in convex position. */
const quadDrawable = (c: PointXZ, ca: PointXZ, p: PointXZ, pa: PointXZ, inward: number, half: number): boolean => {
  // Travel order: the cut first when it starts the deck.
  const [a, aa, q, qa] = inward > 0 ? [c, ca, p, pa] : [p, pa, c, ca];
  const aL = { x: a.x + aa.x * half, z: a.z + aa.z * half };
  const aR = { x: a.x - aa.x * half, z: a.z - aa.z * half };
  const cL = { x: q.x + qa.x * half, z: q.z + qa.z * half };
  const cR = { x: q.x - qa.x * half, z: q.z - qa.z * half };
  const area = (u: PointXZ, v: PointXZ, w: PointXZ) => (v.x - u.x) * (w.z - u.z) - (w.x - u.x) * (v.z - u.z);
  const a1 = area(aL, aR, cR);
  const a2 = area(aL, cR, cL);
  const a3 = area(aR, cR, cL);
  const a4 = area(aL, aR, cL);
  const min = BRIDGE_SWEEP_CLEAR * half;
  return (a1 > min && a2 > min && a3 > min && a4 > min) || (a1 < -min && a2 < -min && a3 < -min && a4 < -min);
};
const cutClearance = (b: FreewayBridge, which: 0 | 1): number => {
  const [t0, t1] = bridgeTrimRange(b);
  const end = which === 0 ? t0 : t1;
  const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
  if (!axis) return end;
  const miters = pathMiters(b);
  const c = pointAt(b, end);
  const corners = [1, -1].map((side) => ({ side, x: c.x + axis.x * side * (b.width / 2), z: c.z + axis.z * side * (b.width / 2) }));
  const inward = which === 0 ? 1 : -1;
  let t = end + inward * bridgeTrimSweep(b, which);
  for (let it = 0; it < 80; it++) {
    const p = pointAt(b, t);
    const d = dirAt(b, t);
    const a = axisAt(b, miters, t);
    const clear = corners.every((q) => ((q.x - (p.x + a.x * q.side * (b.width / 2))) * d.x + (q.z - (p.z + a.z * q.side * (b.width / 2))) * d.z) * -inward >= BRIDGE_SWEEP_CLEAR);
    if (clear && !sweepFolds(c, axis, p, a, inward, b.width / 2)) break;
    t += (inward * BRIDGE_SWEEP_CLEAR) / b.length;
  }
  return t;
};

/** Over this much of the deck beside a cut end (a landed cut, a T) the cut's cross-fall — the road's
 *  or the host's grade across the deck — eases into the deck's own: with the next section flat, on a
 *  road climbing a hillside the slab's edge drops 3u within a unit of its cut (MEASURED, the terrain
 *  poking 2.4u through the deck). */
const BRIDGE_CUT_TWIST = 12;
const BRIDGE_TWIST_EDGE_PITCH = 0.1;
const BRIDGE_CUT_HOLD = 8;

/** Arc fractions of the deck's cross-sections: the trimmed ends, every path vertex, every parapet
 *  gap's ends, every paint change, and enough in between that no chord exceeds
 *  BRIDGE_SEGMENT_LENGTH. Beside a T end the whole oblique cut is ONE section to the first square
 *  one past its farthest corner — a square station inside the sweep would cross the cut and bow-tie
 *  the slab (dark overlapping triangles at junctions). The ribbon and the colliders
 *  share these, so the walkable surface is the drawn one. */
const bridgeStations = (b: FreewayBridge): number[] => {
  const [t0, t1] = bridgeTrimRange(b);
  const in0 = cutClearance(b, 0);
  const in1 = cutClearance(b, 1);
  const breaks = [t0, t1];
  if (in0 > t0 && in0 < in1) breaks.push(in0);
  if (in1 < t1 && in1 > in0) breaks.push(in1);
  const inside = (t: number) => t > in0 + 1e-9 && t < in1 - 1e-9;
  for (const p of b.path) if (inside(p.t)) breaks.push(p.t);
  for (const g of b.gaps ?? []) for (const t of [g.t0, g.t1]) if (inside(t)) breaks.push(t);
  for (const iv of b.paint.off) for (const t of iv) if (inside(t)) breaks.push(t);
  // A crotch fillet's stations: past its corner J; inside the cut's sweep too (every square section
  // past the far corner lies wholly past the cut line), from the first whose quad from the cut the
  // ribbon can draw (quadDrawable).
  const miters0 = pathMiters(b);
  for (const f of crotchFlares(b)) {
    if (!f.acute) continue;
    const axis = f.which === 0 ? b.trimStartAxis! : b.trimEndAxis!;
    const tEnd = f.which === 0 ? t0 : t1;
    const cEnd = pointAt(b, tEnd);
    const ts: number[] = [f.t + (f.dir * f.hostTouch) / b.length];
    for (let k = 1; k <= BRIDGE_CROTCH_STATIONS; k++) ts.push(f.t + (f.dir * f.tangent * k) / BRIDGE_CROTCH_STATIONS / b.length);
    ts.sort((p, q) => (p - q) * f.dir);
    let open = false;
    for (const t of ts) {
      if ((t - f.t) * f.dir * b.length < BRIDGE_SWEEP_CLEAR) continue;
      if (inside(t)) {
        breaks.push(t);
        continue;
      }
      if ((f.which === 0 ? t >= in0 : t <= in1) || (t - tEnd) * f.dir <= 0) continue;
      if (!open && !quadDrawable(cEnd, axis, pointAt(b, t), axisAt(b, miters0, t), f.dir, b.width / 2)) continue;
      open = true;
      breaks.push(t);
    }
  }
  if (b.landings) {
    const R = bridgeRampLength(b) / b.length;
    for (const which of [0, 1] as const) {
      const land = b.landings[which];
      if (!land) continue;
      const Rw = land.ramp / b.length;
      for (const k of BRIDGE_RAMP_STATIONS) breaks.push(which === 0 ? t0 + Rw * k : t1 - Rw * k);
      if (Rw > R) for (const k of BRIDGE_RAMP_STATIONS) breaks.push(which === 0 ? t0 + R * k : t1 - R * k);
    }
  }
  breaks.sort((a, c) => a - c);
  const out: number[] = [];
  for (let i = 0; i + 1 < breaks.length; i++) {
    const span = breaks[i + 1] - breaks[i];
    if (span * b.length < 1e-3) continue;
    const sweep = breaks[i + 1] <= in0 + 1e-9 || breaks[i] >= in1 - 1e-9;
    const n = sweep ? 1 : Math.max(1, Math.ceil((span * b.length) / BRIDGE_SEGMENT_LENGTH));
    for (let k = 0; k < n; k++) out.push(breaks[i] + (span * k) / n);
  }
  out.push(t1);
  return out;
};

/** Where the ramp's own stations stand, as fractions of its length from the end: the quadratic's
 *  curve within 0.02u of its chords. */
const BRIDGE_RAMP_STATIONS = [0.15, 0.35, 0.6, 1];

/** A T end's CROTCH FILLET, so a child deck joins its host without a hard point and a notch between
 *  the two slab edges: at each corner J where the child's edge meets its host's (the cut line — BRIDGE_TEE_OVERLAP inside the host's edge), the slab fills the
 *  crotch up to a circle tangent to both. At the ACUTE corner (the cut's far one) the child's sections
 *  past J widen by e(a) — along the host's line to where the circle touches it (aB), then along the
 *  circle to where it touches the child's edge (T = R / tan(θ/2)) — and the child's wall stands only on
 *  the circle; at the OBTUSE corner (on the cut section itself, which no section may follow closer than
 *  the cut's sweep) the cut section runs on along the host's line by the circle's tangent length and
 *  tapers back to the child's edge over the sweep. The host's wall opens over the fillet (finishDeck).
 *  `t` is J's arc fraction, `dir` inward. */
interface CrotchFlare {
  which: 0 | 1;
  side: 1 | -1;
  dir: 1 | -1;
  acute: boolean;
  t: number;
  theta: number;
  radius: number;
  tangent: number;
  hostTouch: number;
  /** Obtuse: how far the cut section runs on along the host's line, in its axis units. */
  ext: number;
  /** The corner J, the child's edge direction into it (u), the host's line away from it (h), and the
   *  circle's center — world geometry the widening is measured against. */
  jx: number;
  jz: number;
  ux: number;
  uz: number;
  hx: number;
  hz: number;
  cx: number;
  cz: number;
}
const BRIDGE_CROTCH_RADIUS = 6;
const BRIDGE_CROTCH_RADIUS_OBTUSE = 4;
const BRIDGE_CROTCH_STATIONS = 8;
const crotchCache = new WeakMap<FreewayBridge, { landings: unknown; flares: CrotchFlare[] }>();
export const crotchFlares = (b: FreewayBridge): CrotchFlare[] => {
  const hit = crotchCache.get(b);
  if (hit && hit.landings === b.landings) return hit.flares;
  const flares: CrotchFlare[] = [];
  if (b.landings) {
    const [t0, t1] = bridgeTrimRange(b);
    for (const which of [0, 1] as const) {
      const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
      if (!axis || b.landings[which]) continue;
      const tEnd = which === 0 ? t0 : t1;
      const dir = which === 0 ? 1 : -1;
      const c = pointAt(b, tEnd);
      const d = dirAt(b, tEnd);
      const dx = d.x * dir;
      const dz = d.z * dir;
      const al = Math.hypot(axis.x, axis.z) || 1;
      for (const side of [1, -1] as const) {
        const cos = (dx * axis.x + dz * axis.z) * side / al;
        const theta = Math.acos(Math.max(-1, Math.min(1, cos)));
        if (theta < 0.05 || theta > Math.PI - 0.05) continue;
        const jx = c.x + axis.x * side * (b.width / 2);
        const jz = c.z + axis.z * side * (b.width / 2);
        const t = tEnd + (dir * ((jx - c.x) * dx + (jz - c.z) * dz)) / b.length;
        const acute = theta < Math.PI / 2;
        const radius = acute ? BRIDGE_CROTCH_RADIUS : BRIDGE_CROTCH_RADIUS_OBTUSE;
        const tangent = radius / Math.tan(theta / 2);
        const hx = (axis.x * side) / al;
        const hz = (axis.z * side) / al;
        const bx = dx + hx;
        const bz = dz + hz;
        const bl = Math.hypot(bx, bz) || 1;
        const cd = radius / Math.sin(theta / 2);
        flares.push({
          which, side, dir, acute, t, theta, radius, tangent, hostTouch: tangent * Math.cos(theta), ext: acute ? 0 : tangent / al,
          jx, jz, ux: dx, uz: dz, hx, hz, cx: jx + (bx / bl) * cd, cz: jz + (bz / bl) * cd,
        });
      }
    }
  }
  crotchCache.set(b, { landings: b.landings, flares });
  return flares;
};
/** An acute fillet's widening (axis units) of a section (center p, lateral axis a) on its side: from the
 *  child's edge along the section out to the fillet's boundary — the host's line or the circle,
 *  whichever the section meets first — while its edge point lies between J and the circle's tangency. */
const crotchWidening = (b: FreewayBridge, f: CrotchFlare, px: number, pz: number, ax: number, az: number): number => {
  if (!f.acute) return 0;
  const half = b.width / 2;
  const sx = ax * f.side;
  const sz = az * f.side;
  const ex = px + sx * half;
  const ez = pz + sz * half;
  const along = (ex - f.jx) * f.ux + (ez - f.jz) * f.uz;
  if (along <= 0 || along >= f.tangent) return 0;
  // X(l) = E + s·l: the host's line through J along h, and the circle.
  let best = Infinity;
  const den = sx * f.hz - sz * f.hx;
  if (Math.abs(den) > 1e-9) {
    const l = -((ex - f.jx) * f.hz - (ez - f.jz) * f.hx) / den;
    if (l >= 0) best = l;
  }
  const qx = ex - f.cx;
  const qz = ez - f.cz;
  const A = sx * sx + sz * sz;
  const B = 2 * (qx * sx + qz * sz);
  const C = qx * qx + qz * qz - f.radius * f.radius;
  const disc = B * B - 4 * A * C;
  if (disc >= 0) {
    const l = (-B - Math.sqrt(disc)) / (2 * A);
    if (l >= 0 && l < best) best = l;
  }
  return Number.isFinite(best) ? best : 0;
};

/** The lateral axis at each path vertex: mitered between its two legs (scaled so the edges stay W/2
 *  from both), the leg's own normal at the two ends. */
export const pathMiters = (b: FreewayBridge): { x: number; z: number }[] => {
  const p = b.path;
  const n = p.length;
  const normal = (i: number) => {
    const dx = p[i + 1].x - p[i].x;
    const dz = p[i + 1].z - p[i].z;
    const l = Math.hypot(dx, dz) || 1;
    return { x: -dz / l, z: dx / l };
  };
  return p.map((_, i) => {
    if (i === 0) return normal(0);
    if (i === n - 1) return normal(n - 2);
    const a = normal(i - 1);
    const c = normal(i);
    let mx = a.x + c.x;
    let mz = a.z + c.z;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const scale = 1 / Math.max(0.35, mx * c.x + mz * c.z);
    return { x: mx * scale, z: mz * scale };
  });
};

/** The deck's cross-sections. Between path vertices the lateral axis is INTERPOLATED from their
 *  miters, so a section a hair off a vertex has nearly its axis: switching from a miter to the leg's
 *  normal between two close sections would swing the edges backwards and bow-tie the slab — sand
 *  showing through wedge-shaped holes in the deck. A T end's section lies along its cut. */
export const bridgeSections = (b: FreewayBridge): BridgeSection[] => {
  const stations = bridgeStations(b);
  const n = stations.length;
  const miters = pathMiters(b);
  const t0 = stations[0];
  const t1 = stations[n - 1];
  // The twist runs from the first SQUARE section past an oblique cut (cutClearance), not from the cut's
  // centerline: the cut's far corner and that section's corner nearly coincide, and easing from the
  // centerline drops the slab's edge a unit and a half between them (a crease the ground stands
  // through).
  // Past a landed CUT end the cut's cross-fall is held BRIDGE_CUT_HOLD further, so the slab there lies
  // in one plane with the flush road in front: the terrain's triangles across the seam can follow both
  // (a cross-fall easing from the square section on warps the slab under them, and they either rise
  // through it or are lowered into a step in front of the cut — MEASURED on the LOD1 mesh).
  const hold = (which: 0 | 1): number => (b.landings?.[which]?.ramp === 0 ? BRIDGE_CUT_HOLD / b.length : 0);
  const c0 = b.trimStartAxis ? Math.min(cutClearance(b, 0) + hold(0), t1) : t0;
  const c1 = b.trimEndAxis ? Math.max(cutClearance(b, 1) - hold(1), c0) : t1;
  // An oblique end's far corner lies further along the deck than its center: where the deck climbs
  // away from its end, the square sections there stand above the cut's own corner by the deck's pitch
  // times that offset (a crease the road rises through; a ledge over the road beside a landed end).
  // Near such an end the deck's lines of equal height run PARALLEL TO THE CUT:
  // each section's cross-fall takes −κ·dy/ds, κ the cut's along-offset per lateral unit, easing out
  // with the cut's own cross-fall.
  const skewOf = (axis: BridgeTrimAxis | undefined, t: number): number => {
    if (!axis) return 0;
    const d = dirAt(b, t);
    const an = axis.x * -d.z + axis.z * d.x;
    return Math.abs(an) > 1e-6 ? (axis.x * d.x + axis.z * d.z) / an : 0;
  };
  const skew0 = skewOf(b.trimStartAxis, t0);
  const skew1 = skewOf(b.trimEndAxis, t1);
  const pitchAt = (t: number): number => {
    const e = Math.min(0.5 / b.length, (t1 - t0) / 4);
    return (bridgeDeckY(b, t + e) - bridgeDeckY(b, t - e)) / (2 * e * b.length);
  };
  const half = b.width / 2;
  // The twist from a cut's cross-fall into the deck's own runs at least BRIDGE_CUT_TWIST, and as far as
  // keeps the slab's EDGES from pitching more than BRIDGE_TWIST_EDGE_PITCH on average against its
  // centerline: a hillside landing's 0.42 cross-fall eased out over 12u pitched the edges 0.55 — a
  // lopsided, kinked slab (Evan, 73/76.png).
  const twistOf = (cross: number): number => Math.min(Math.max(BRIDGE_CUT_TWIST, (Math.abs(cross) * half) / BRIDGE_TWIST_EDGE_PITCH), ((c1 - c0) * b.length) / 2);
  const cross0 = b.trimStartAxis ? b.trimStartAxis.slope - skew0 * pitchAt(c0) : 0;
  const cross1 = b.trimEndAxis ? b.trimEndAxis.slope - skew1 * pitchAt(c1) : 0;
  const twist0 = twistOf(cross0);
  const twist1 = twistOf(cross1);
  const flares = crotchFlares(b);
  return stations.map((t, i) => {
    const pt = pointAt(b, t);
    const ramp = bridgeRampAt(b, t);
    const s = { t, x: pt.x, y: bridgeDeckY(b, t) + ramp.dy, z: pt.z, ax: 0, az: 0, slope: ramp.slope, wall: ramp.wall, wl: half, wr: half };
    const end = i === 0 ? 0 : i === n - 1 ? 1 : -1;
    const widen = () => {
      for (const f of flares) {
        const e = f.acute ? (end < 0 ? crotchWidening(b, f, s.x, s.z, s.ax, s.az) : 0) : f.which === end ? f.ext : 0;
        if (f.side === 1) s.wl += e;
        else s.wr += e;
      }
    };
    const axis = end === 0 ? b.trimStartAxis : end === 1 ? b.trimEndAxis : undefined;
    if (axis) {
      s.ax = axis.x;
      s.az = axis.z;
      s.slope = axis.slope;
      widen();
      return s;
    }
    if (b.trimStartAxis) s.slope += (b.trimStartAxis.slope - skew0 * pitchAt(t)) * (1 - smoothstep(0, twist0, (t - c0) * b.length));
    if (b.trimEndAxis) s.slope += (b.trimEndAxis.slope - skew1 * pitchAt(t)) * (1 - smoothstep(0, twist1, (c1 - t) * b.length));
    const a = axisAt(b, miters, t);
    s.ax = a.x;
    s.az = a.z;
    widen();
    return s;
  });
};

/** Distance from a point to a deck's centerline. */
export const pathDistance = (b: FreewayBridge, x: number, z: number): number =>
  projectOnPolyline(
    b.path.map((q) => q.x),
    b.path.map((q) => q.z),
    x,
    z,
  ).d;

/** Where each parapet wall's center line runs: the lateral offset from the centerline. */
export const bridgeParapetLine = (b: FreewayBridge): number => b.width / 2 - BRIDGE_PARAPET_WIDTH / 2;
