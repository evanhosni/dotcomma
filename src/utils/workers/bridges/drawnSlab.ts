/** Where a world point lies against a deck's DRAWN slab — the ribbon's own triangles — for the ground
 *  cut under it (computeVertexData step 7, bridges/deckGround.ts). */

import { smoothstep } from "../../math/_math";
import { dropOldestHalf } from "../cellCache";
import { BRIDGE_CUT_BELOW_TOP, BRIDGE_CUT_FEATHER } from "./constants";
import { bridgeRampAt, bridgeSections, bridgeTrimRange } from "./deckGeometry";
import type { PointXZ } from "../../math/types";
import type { BridgeSection, FreewayBridge } from "./types";

/** Where a world point lies against a deck's DRAWN slab — the ribbon's own triangles between its
 *  sections (bridgeSections: ramps, cross-falls, landed cuts, T cuts and crotch fillets included; each
 *  quad split along the diagonal the ribbon draws, from its first section's left corner to its second's
 *  right) — for the ground cut under it (computeVertexData step 7). `weight` is 1 over the slab and
 *  within `margin` beside it (the terrain's vertex spacing: a triangle with a vertex beyond the slab's
 *  edge still spans the slab),
 *  fading to 0 over BRIDGE_CUT_FEATHER past that; 0 beyond a ramped or a T end (a landed ramp dives
 *  under its road, a T end lies in its host, whose own cut covers it) — and in front of a landed CUT
 *  end, where the road meets the slab, `flush` is the road's height (NaN elsewhere). `own` is the drawn
 *  top at the point's nearest slab point, `t` its arc fraction, `lat` its lateral offset, and `ref` the
 *  height the ground there rests on at most before its triangles are checked (bridgeTriangleCap): the
 *  flush road, or the top less BRIDGE_CUT_BELOW_TOP — beside the slab the lower of the top at its edge
 *  and the slab's plane carried on (the edge's own top, on a cross-falling slab's low side, would tilt a
 *  LOD triangle reaching over the slab above it: a lip in front of a cut end); over a ramped end's
 *  first units the slab dives under its road on purpose, and the road there stays at the unramped line.
 *  `cutIn`: how far inward of a landed cut end's line. */
export const bridgeDrawn = { weight: 0, t: 0, lat: 0, flush: NaN, own: Infinity, ref: Infinity, cutIn: Infinity };
/** In front of a cut end the flush road carries the deck's pitch on at no more than this. */
const BRIDGE_FLUSH_PITCH = 0.1;
/** Over a ramped landed end's first units the road stays over the slab's dive (no ledge). */
const BRIDGE_RAMP_END_KEEP = 3;
/** A deck's drawn triangles — per quad two, each 3 corners of (x, z, y, t, lat) — its bounds, each
 *  quad's bounding circle (center x, z, radius), and which quads lie in a ramped end's dive. */
interface DrawnDeck {
  /** What the sections were built from that can still change (finishDeck sets the gaps after other
   *  decks have already asked where this one lies). */
  gaps: FreewayBridge["gaps"];
  landings: FreewayBridge["landings"];
  S: BridgeSection[];
  box: number[];
  circles: Float64Array;
  tri: Float64Array;
  dive: Uint8Array;
}
const TRI_STRIDE = 15;
const drawnSections = new WeakMap<FreewayBridge, DrawnDeck>();
const drawnOf = (b: FreewayBridge): DrawnDeck => {
  let entry = drawnSections.get(b);
  if (!entry || entry.gaps !== b.gaps || entry.landings !== b.landings) {
    const S = bridgeSections(b);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const s of S) {
      for (const lat of [s.wl, -s.wr]) {
        const px = s.x + s.ax * lat;
        const pz = s.z + s.az * lat;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px);
        z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
      }
    }
    const [t0, t1] = bridgeTrimRange(b);
    const keep = BRIDGE_RAMP_END_KEEP / b.length;
    const ramped0 = (b.landings?.[0]?.ramp ?? 0) > 0;
    const ramped1 = (b.landings?.[1]?.ramp ?? 0) > 0;
    const nq = Math.max(0, S.length - 1);
    const circles = new Float64Array(nq * 3);
    const tri = new Float64Array(nq * 2 * TRI_STRIDE);
    const dive = new Uint8Array(nq);
    const corner = (s: BridgeSection, lat: number, out: Float64Array, o: number) => {
      out[o] = s.x + s.ax * lat;
      out[o + 1] = s.z + s.az * lat;
      out[o + 2] = s.y + s.slope * lat;
      out[o + 3] = s.t;
      out[o + 4] = lat;
    };
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i];
      const c = S[i + 1];
      const o = i * 2 * TRI_STRIDE;
      // The ribbon's split: (aL, aR, cR) and (aL, cR, cL).
      corner(a, a.wl, tri, o);
      corner(a, -a.wr, tri, o + 5);
      corner(c, -c.wr, tri, o + 10);
      corner(a, a.wl, tri, o + TRI_STRIDE);
      corner(c, -c.wr, tri, o + TRI_STRIDE + 5);
      corner(c, c.wl, tri, o + TRI_STRIDE + 10);
      let cx = 0, cz = 0;
      for (const k of [0, 5, 10, TRI_STRIDE + 10]) {
        cx += tri[o + k] / 4;
        cz += tri[o + k + 1] / 4;
      }
      let r = 0;
      for (const k of [0, 5, 10, TRI_STRIDE + 10]) r = Math.max(r, Math.hypot(tri[o + k] - cx, tri[o + k + 1] - cz));
      circles[i * 3] = cx;
      circles[i * 3 + 1] = cz;
      circles[i * 3 + 2] = r;
      dive[i] = (ramped0 && a.t < t0 + keep) || (ramped1 && c.t > t1 - keep) ? 1 : 0;
    }
    entry = { gaps: b.gaps, landings: b.landings, S, box: [x0, z0, x1, z1], circles, tri, dive };
    drawnSections.set(b, entry);
  }
  return entry;
};

/** Barycentric (l1, l2) of (x, z) in the triangle at tri[o]: corners p0, p1, p2 (5 numbers each). */
const baryOf = (tri: Float64Array, o: number, x: number, z: number, out: number[]): boolean => {
  const x0 = tri[o], z0 = tri[o + 1];
  const e1x = tri[o + 5] - x0, e1z = tri[o + 6] - z0;
  const e2x = tri[o + 10] - x0, e2z = tri[o + 11] - z0;
  const det = e1x * e2z - e2x * e1z;
  if (Math.abs(det) < 1e-12) return false;
  out[0] = ((x - x0) * e2z - e2x * (z - z0)) / det;
  out[1] = (e1x * (z - z0) - (x - x0) * e1z) / det;
  return true;
};
const bary = [0, 0];
/** A corner field (2 = y, 3 = t, 4 = lat) of the triangle at o at barycentric (l1, l2). */
const triField = (tri: Float64Array, o: number, k: number, l1: number, l2: number): number => tri[o + k] + (tri[o + 5 + k] - tri[o + k]) * l1 + (tri[o + 10 + k] - tri[o + k]) * l2;
/** The nearest point of the triangle at o to (x, z), as barycentric (l1, l2) into `bary`; its distance. */
const nearestOnTriangle = (tri: Float64Array, o: number, x: number, z: number): number => {
  if (!baryOf(tri, o, x, z, bary)) return Infinity;
  if (bary[0] >= 0 && bary[1] >= 0 && bary[0] + bary[1] <= 1) return 0;
  let best = Infinity;
  let bl1 = 0;
  let bl2 = 0;
  // Edges p0→p1 (l2 = 0), p0→p2 (l1 = 0), p1→p2 (l1 + l2 = 1).
  for (const [ka, kb, la1, la2, lb1, lb2] of TRI_EDGES) {
    const ax = tri[o + ka], az = tri[o + ka + 1];
    const dx = tri[o + kb] - ax, dz = tri[o + kb + 1] - az;
    const l2e = dx * dx + dz * dz;
    const f = l2e > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2e)) : 0;
    const d = Math.hypot(x - ax - dx * f, z - az - dz * f);
    if (d < best) {
      best = d;
      bl1 = la1 + (lb1 - la1) * f;
      bl2 = la2 + (lb2 - la2) * f;
    }
  }
  bary[0] = bl1;
  bary[1] = bl2;
  return best;
};
const TRI_EDGES: number[][] = [
  [0, 5, 0, 0, 1, 0],
  [0, 10, 0, 0, 0, 1],
  [5, 10, 1, 0, 0, 1],
];

export const bridgeDrawnAt = (b: FreewayBridge, x: number, z: number, margin: number): void => {
  bridgeDrawn.weight = 0;
  bridgeDrawn.flush = NaN;
  bridgeDrawn.own = Infinity;
  bridgeDrawn.ref = Infinity;
  bridgeDrawn.cutIn = Infinity;
  const { S, box, circles, tri } = drawnOf(b);
  const reach = margin + BRIDGE_CUT_FEATHER;
  if (x < box[0] - reach || x > box[2] + reach || z < box[1] - reach || z > box[3] + reach || S.length < 2) return;
  const n = S.length;
  // In front of an end section's line (its distance), or −1.
  const endSide = (e: BridgeSection, o: BridgeSection): number => {
    const side = (x - e.x) * e.az - (z - e.z) * e.ax;
    const inward = (o.x - e.x) * e.az - (o.z - e.z) * e.ax;
    return side * inward < 0 ? Math.abs(side) / (Math.hypot(e.ax, e.az) || 1) : -1;
  };
  const front0 = endSide(S[0], S[1]);
  const front1 = endSide(S[n - 1], S[n - 2]);
  const cutEnd = (which: 0 | 1) => !!(which === 0 ? b.trimStartAxis : b.trimEndAxis) && b.landings?.[which]?.ramp === 0;
  // Past a ramped or a T end the point belongs to the road or the host, not to this slab.
  if ((front0 >= 0 && !cutEnd(0)) || (front1 >= 0 && !cutEnd(1))) return;
  // In front of a landed CUT end the road meets the slab: within the margin it lies on the slab's own
  // surface carried on past the cut, so a terrain triangle across the seam is flat with the slab. (The
  // cut's own cross-fall carried on at the centerline's pitch — not the slab's: the next section's
  // cross-fall differs, BRIDGE_CUT_TWIST, and extrapolating it tilted the road in front off the cut; the
  // pitch is capped, or a deck climbing to a high arch dragged the road in front of it down by units.)
  for (const which of [0, 1] as const) {
    const d = which === 0 ? front0 : front1;
    if (d < 0 || d >= margin || !cutEnd(which)) continue;
    const e = which === 0 ? S[0] : S[n - 1];
    const q = which === 0 ? S[1] : S[n - 2];
    const le = ((x - e.x) * e.ax + (z - e.z) * e.az) / (e.ax * e.ax + e.az * e.az || 1);
    if (le > e.wl || le < -e.wr) continue;
    const seg = Math.hypot(q.x - e.x, q.z - e.z) || 1;
    const inward = (q.y - e.y) / seg;
    const flush = e.y + e.slope * le - Math.max(-BRIDGE_FLUSH_PITCH, Math.min(BRIDGE_FLUSH_PITCH, inward)) * d;
    if (Number.isNaN(bridgeDrawn.flush) || flush < bridgeDrawn.flush) {
      bridgeDrawn.weight = 1;
      bridgeDrawn.flush = flush;
      bridgeDrawn.ref = flush;
      bridgeDrawn.t = e.t;
      bridgeDrawn.lat = le;
    }
  }
  let best = Infinity;
  let bo = -1;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i + 1 < n; i++) {
    const qx = x - circles[i * 3];
    const qz = z - circles[i * 3 + 1];
    const qr = circles[i * 3 + 2] + reach;
    if (qx * qx + qz * qz > qr * qr) continue;
    for (const o of [i * 2 * TRI_STRIDE, i * 2 * TRI_STRIDE + TRI_STRIDE]) {
      const d = nearestOnTriangle(tri, o, x, z);
      if (d < best) {
        best = d;
        bo = o;
        b1 = bary[0];
        b2 = bary[1];
      }
    }
  }
  if (bo < 0 || best >= reach) return;
  const own = triField(tri, bo, 2, b1, b2);
  const t = triField(tri, bo, 3, b1, b2);
  const lat = triField(tri, bo, 4, b1, b2);
  // Past a landed CUT end by more than the margin, beside that end, it is the road in front of the deck,
  // which no terrain triangle reaching the slab can hold (cut down to the slab's nearest cross-falling
  // corner there, the road would dip a few units before the seam).
  if ((front0 >= margin && t <= S[1].t) || (front1 >= margin && t >= S[n - 2].t)) return;
  bridgeDrawn.own = own;
  bridgeDrawn.weight = Math.max(bridgeDrawn.weight, best <= margin ? 1 : 1 - smoothstep(margin, reach, best));
  if (!Number.isNaN(bridgeDrawn.flush)) return;
  // How far inward of a landed cut end's line (computeVertexData fills the ground up under the seam).
  for (const which of [0, 1] as const) {
    if (!cutEnd(which)) continue;
    const e = which === 0 ? S[0] : S[n - 1];
    const o = which === 0 ? S[1] : S[n - 2];
    const side = (x - e.x) * e.az - (z - e.z) * e.ax;
    const inward = (o.x - e.x) * e.az - (o.z - e.z) * e.ax;
    if (side * inward >= 0) bridgeDrawn.cutIn = Math.min(bridgeDrawn.cutIn, Math.abs(side) / (Math.hypot(e.ax, e.az) || 1));
  }
  // The slab's plane carried on to the point itself (the nearest triangle's), on the low side only.
  baryOf(tri, bo, x, z, bary);
  const outside = best > 0 ? Math.min(own, triField(tri, bo, 2, bary[0], bary[1])) : own;
  const s = t * b.length;
  const fromEnds = Math.min(b.landings?.[0] ? s - (b.trimStart ?? 0) : Infinity, b.landings?.[1] ? b.length - (b.trimEnd ?? 0) - s : Infinity);
  const ramp = bridgeRampAt(b, t);
  bridgeDrawn.ref = outside - (ramp.dy + ramp.slope * lat) * (1 - smoothstep(0, BRIDGE_RAMP_END_KEEP, fromEnds)) - BRIDGE_CUT_BELOW_TOP;
  bridgeDrawn.t = t;
  bridgeDrawn.lat = lat;
};

/** The DRAWN slab's top at (x, z) — the ribbon's own triangles — or Infinity off the slab. */
export const bridgeDrawnTopAt = (b: FreewayBridge, x: number, z: number): number => {
  bridgeDrawnAt(b, x, z, 0);
  return bridgeDrawn.weight >= 1 && Number.isNaN(bridgeDrawn.flush) && Number.isFinite(bridgeDrawn.own) ? bridgeDrawn.own : Infinity;
};
/** Whether (x, z) lies on a deck's DRAWN slab (its own triangles; not the flush road in front of a cut). */
export const drawnOn = (b: FreewayBridge, x: number, z: number): boolean => {
  bridgeDrawnAt(b, x, z, 0);
  return bridgeDrawn.weight >= 1 && Number.isNaN(bridgeDrawn.flush) && Number.isFinite(bridgeDrawn.own);
};
/** Whether (x, z) lies on a deck's DRAWN slab with at least `margin` of it all around (probed on a ring). */
export const drawnCovers = (b: FreewayBridge, x: number, z: number, margin: number): boolean => {
  const on = (px: number, pz: number): boolean => {
    bridgeDrawnAt(b, px, pz, 0);
    return bridgeDrawn.weight >= 1 && Number.isNaN(bridgeDrawn.flush) && Number.isFinite(bridgeDrawn.own) && bridgeDrawn.ref !== Infinity;
  };
  if (!on(x, z)) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    if (!on(x + Math.cos(a) * margin, z + Math.sin(a) * margin)) return false;
  }
  return true;
};

/** Signed distance from (x, z) to a deck's drawn SIDE edges (its sections' outer corners, end to end;
 *  not its end sections): positive inside the slab, negative beside it. */
export const bridgeSideIn = (b: FreewayBridge, x: number, z: number): number => {
  const S = drawnOf(b).S;
  let best = Infinity;
  let sign = 1;
  for (const side of [1, -1] as const) {
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i];
      const c = S[i + 1];
      const wa = side === 1 ? a.wl : -a.wr;
      const wc = side === 1 ? c.wl : -c.wr;
      const ax = a.x + a.ax * wa;
      const az = a.z + a.az * wa;
      const dx = c.x + c.ax * wc - ax;
      const dz = c.z + c.az * wc - az;
      const l2 = dx * dx + dz * dz;
      const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      const d = Math.hypot(x - ax - dx * u, z - az - dz * u);
      if (d >= best) continue;
      best = d;
      // Inside lies toward the section's own center from its edge.
      const toCenter = (a.x - ax) * dz - (a.z - az) * dx;
      const toPoint = (x - ax) * dz - (z - az) * dx;
      sign = toCenter * toPoint >= 0 ? 1 : -1;
    }
  }
  return sign * best;
};

/** The height a terrain vertex may stand at beside or under a deck, EXACT for the terrain's own
 *  triangles, not just its vertices. On the
 *  vertex lattice (spacing s, the diagonal from (x, z+s) to (x+s, z) as the terrain worker builds it)
 *  each vertex rests on its reference (bridgeDrawn.ref) lowered by the worst amount any of its six
 *  triangles, with every vertex on its reference, would rise over the drawn slab inside it; every
 *  vertex of such a triangle is lowered by at least that, so no point of it rises through. Where the
 *  slab is planar that is nothing: resting each vertex on the least top around it over-cuts a
 *  cross-falling or pitched slab by units, and in front of a cut end the road steps down into the cut;
 *  resting it on the top above it lets the triangles between rise through a slab that is not planar (a
 *  cut's cross-fall easing into the deck's, an arch). Infinity where the vertex is not
 *  within `margin` of the slab (no triangle of it overlaps). Between lattice points (the player's
 *  backstop, a probe) the caps of the triangle holding the point, interpolated as the mesh draws it.
 *  Clobbers bridgeDrawn. */
export const bridgeTriangleCap = (b: FreewayBridge, x: number, z: number, spacing: number, margin: number): number => {
  const fx = x / spacing;
  const fz = z / spacing;
  const ix = Math.round(fx);
  const iz = Math.round(fz);
  if (Math.abs(fx - ix) < 1e-4 && Math.abs(fz - iz) < 1e-4) return latticeCap(b, ix, iz, spacing, margin);
  const i0 = Math.floor(fx);
  const j0 = Math.floor(fz);
  const u = fx - i0;
  const v = fz - j0;
  const lower = u + v <= 1;
  const [ax, az, bx, bz, cx, cz] = lower ? [i0, j0, i0 + 1, j0, i0, j0 + 1] : [i0 + 1, j0 + 1, i0, j0 + 1, i0 + 1, j0];
  const wb = lower ? u : 1 - u;
  const wc = lower ? v : 1 - v;
  const ca = latticeCap(b, ax, az, spacing, margin);
  const cb = latticeCap(b, bx, bz, spacing, margin);
  const cc = latticeCap(b, cx, cz, spacing, margin);
  if (!Number.isFinite(ca + cb + cc)) return Infinity;
  return ca * (1 - wb - wc) + cb * wb + cc * wc;
};
/** The six triangles around a lattice vertex, as three (dx, dz) offsets each, then the lattice quad
 *  (dx, dz) holding it and whether it is the quad's upper triangle (its key in the cap cache). */
const LATTICE_TRIANGLES = [
  [0, 0, 0, 1, 1, 0, 0, 0, 0],
  [-1, 0, -1, 1, 0, 0, -1, 0, 0],
  [-1, 1, 0, 1, 0, 0, -1, 0, 1],
  [0, -1, 0, 0, 1, -1, 0, -1, 0],
  [0, 0, 1, 0, 1, -1, 0, -1, 1],
  [-1, 0, 0, 0, 0, -1, -1, -1, 1],
];
/** Per deck and lattice (spacing, margin): each lattice vertex's reference and each lattice triangle's
 *  rise over the slab — a vertex's cap reads 9 references and 6 triangles its neighbors read too
 *  (uncached, the cap is half of an LOD1 chunk's build beside a deck). */
interface LatticeCapCache {
  key: string;
  refs: Map<number, number>;
  tris: Map<number, number>;
}
const latticeCapCaches = new WeakMap<FreewayBridge, LatticeCapCache[]>();
const LATTICE_CAP_CACHE_MAX = 32768;
const latticeCapCacheOf = (b: FreewayBridge, spacing: number, margin: number): LatticeCapCache => {
  let list = latticeCapCaches.get(b);
  if (!list) latticeCapCaches.set(b, (list = []));
  const key = `${spacing},${margin}`;
  let c = list.find((q) => q.key === key);
  if (!c) list.push((c = { key, refs: new Map(), tris: new Map() }));
  if (c.refs.size > LATTICE_CAP_CACHE_MAX) dropOldestHalf(c.refs);
  if (c.tris.size > LATTICE_CAP_CACHE_MAX) dropOldestHalf(c.tris);
  return c;
};
const latticeKeyOf = (ix: number, iz: number): number => (ix + 1048576) * 2097152 + (iz + 1048576);
const latticeRef = new Float64Array(9);
const latticeTx = [0, 0, 0];
const latticeTz = [0, 0, 0];
const latticeTy = [0, 0, 0];
const latticeCap = (b: FreewayBridge, ix: number, iz: number, spacing: number, margin: number): number => {
  // References of the vertex and its 8 lattice neighbors (index (dx+1)*3 + (dz+1)); Infinity beyond
  // the margin (no triangle of such a vertex overlaps the slab).
  const cache = latticeCapCacheOf(b, spacing, margin);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const k = latticeKeyOf(ix + dx, iz + dz);
      let r = cache.refs.get(k);
      if (r === undefined) {
        bridgeDrawnAt(b, (ix + dx) * spacing, (iz + dz) * spacing, margin);
        r = bridgeDrawn.weight >= 1 ? bridgeDrawn.ref : Infinity;
        cache.refs.set(k, r);
      }
      latticeRef[(dx + 1) * 3 + dz + 1] = r;
    }
  }
  const ref = latticeRef[4];
  if (!Number.isFinite(ref)) return Infinity;
  let worst = 0;
  for (const tri of LATTICE_TRIANGLES) {
    const k0 = (tri[0] + 1) * 3 + tri[1] + 1;
    const k1 = (tri[2] + 1) * 3 + tri[3] + 1;
    const k2 = (tri[4] + 1) * 3 + tri[5] + 1;
    if (!Number.isFinite(latticeRef[k0] + latticeRef[k1] + latticeRef[k2])) continue;
    const tk = latticeKeyOf(ix + tri[6], iz + tri[7]) * 2 + tri[8];
    const known = cache.tris.get(tk);
    if (known !== undefined) {
      worst = Math.max(worst, known);
      continue;
    }
    for (let k = 0; k < 3; k++) {
      latticeTx[k] = (ix + tri[2 * k]) * spacing;
      latticeTz[k] = (iz + tri[2 * k + 1]) * spacing;
    }
    latticeTy[0] = latticeRef[k0];
    latticeTy[1] = latticeRef[k1];
    latticeTy[2] = latticeRef[k2];
    const rise = triangleOverSlab(b, latticeTx, latticeTz, latticeTy);
    cache.tris.set(tk, rise);
    worst = Math.max(worst, rise);
  }
  return ref - worst;
};

/** How far a terrain triangle (its three vertices' xz and heights) rises over the drawn slab at worst,
 *  over the part of it that lies on the slab (−Infinity when none does): clipped to each of the slab's
 *  own triangles, both planes, so the difference peaks at a vertex of the clipped polygon — exact. */
const clipX: number[] = [];
const clipZ: number[] = [];
const clipNX: number[] = [];
const clipNZ: number[] = [];
const triangleOverSlab = (b: FreewayBridge, tx: number[], tz: number[], ty: number[]): number => {
  const { S, circles, tri, dive } = drawnOf(b);
  const det = (tx[1] - tx[0]) * (tz[2] - tz[0]) - (tx[2] - tx[0]) * (tz[1] - tz[0]);
  if (Math.abs(det) < 1e-12) return -Infinity;
  const plane = (x: number, z: number): number => {
    const l1 = ((x - tx[0]) * (tz[2] - tz[0]) - (tx[2] - tx[0]) * (z - tz[0])) / det;
    const l2 = ((tx[1] - tx[0]) * (z - tz[0]) - (x - tx[0]) * (tz[1] - tz[0])) / det;
    return ty[0] + (ty[1] - ty[0]) * l1 + (ty[2] - ty[0]) * l2;
  };
  const cx = (tx[0] + tx[1] + tx[2]) / 3;
  const cz = (tz[0] + tz[1] + tz[2]) / 3;
  const cr = Math.max(Math.hypot(tx[0] - cx, tz[0] - cz), Math.hypot(tx[1] - cx, tz[1] - cz), Math.hypot(tx[2] - cx, tz[2] - cz));
  let worst = -Infinity;
  for (let i = 0; i + 1 < S.length; i++) {
    // (A ramped end's dive lies under its road by design.)
    if (dive[i]) continue;
    const qx = cx - circles[i * 3];
    const qz = cz - circles[i * 3 + 1];
    const qr = circles[i * 3 + 2] + cr;
    if (qx * qx + qz * qz > qr * qr) continue;
    for (const o of [i * 2 * TRI_STRIDE, i * 2 * TRI_STRIDE + TRI_STRIDE]) {
      // The slab triangle, counter-clockwise.
      let ox0 = tri[o], oz0 = tri[o + 1], ox1 = tri[o + 5], oz1 = tri[o + 6], ox2 = tri[o + 10], oz2 = tri[o + 11];
      const area = (ox1 - ox0) * (oz2 - oz0) - (ox2 - ox0) * (oz1 - oz0);
      if (Math.abs(area) < 1e-9) continue;
      if (area < 0) {
        [ox1, ox2] = [ox2, ox1];
        [oz1, oz2] = [oz2, oz1];
      }
      const ox = [ox0, ox1, ox2];
      const oz = [oz0, oz1, oz2];
      // Sutherland–Hodgman: the terrain triangle clipped by each edge of the slab's.
      clipX.length = 0;
      clipZ.length = 0;
      clipX.push(tx[0], tx[1], tx[2]);
      clipZ.push(tz[0], tz[1], tz[2]);
      for (let k = 0; k < 3 && clipX.length > 0; k++) {
        const ex = ox[(k + 1) % 3] - ox[k];
        const ez = oz[(k + 1) % 3] - oz[k];
        clipNX.length = 0;
        clipNZ.length = 0;
        const m = clipX.length;
        for (let p = 0; p < m; p++) {
          const x0 = clipX[p], z0 = clipZ[p];
          const x1 = clipX[(p + 1) % m], z1 = clipZ[(p + 1) % m];
          const s0 = ex * (z0 - oz[k]) - ez * (x0 - ox[k]);
          const s1 = ex * (z1 - oz[k]) - ez * (x1 - ox[k]);
          if (s0 >= 0) {
            clipNX.push(x0);
            clipNZ.push(z0);
          }
          if (s0 >= 0 !== s1 >= 0) {
            const f = s0 / (s0 - s1);
            clipNX.push(x0 + (x1 - x0) * f);
            clipNZ.push(z0 + (z1 - z0) * f);
          }
        }
        clipX.length = 0;
        clipZ.length = 0;
        clipX.push(...clipNX);
        clipZ.push(...clipNZ);
      }
      for (let p = 0; p < clipX.length; p++) {
        if (!baryOf(tri, o, clipX[p], clipZ[p], bary)) continue;
        worst = Math.max(worst, plane(clipX[p], clipZ[p]) - triField(tri, o, 2, bary[0], bary[1]));
      }
    }
  }
  return worst;
};

/** The MOUTH of a landed CUT end: the stretch of its road between the road's centerline (the deck
 *  path's end) and the cut, across the deck's width, where the road's curb and sidewalk would run across
 *  the deck's mouth as a step up onto a slab starting at the sidewalk's height. There the road is ASPHALT at the asphalt's height: computeVertexData lowers the curb's rise out of the
 *  ground and paints the field as road, and the deck's cut end starts on that asphalt (landedCut).
 *  `bridgeMouth.weight` is 1 inside, fading over BRIDGE_MOUTH_FEATHER past the deck's sides, 0
 *  elsewhere. */
export const bridgeMouth = { weight: 0, depth: 0, top: 0 };
const BRIDGE_MOUTH_FEATHER = 3;
/** How far in front of a cut end its mouth reaches (the road's curb and sidewalk, and any sand the
 *  cut's straight line leaves between itself and a curving pavement edge). */
const BRIDGE_MOUTH_DEPTH = 12;
export const bridgeMouthAt = (b: FreewayBridge, x: number, z: number, reach = BRIDGE_MOUTH_DEPTH): void => {
  bridgeMouth.weight = 0;
  const half = b.width / 2;
  for (const which of [0, 1] as const) {
    const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
    const landing = b.landings?.[which];
    if (!axis || !landing || landing.ramp > 0) continue;
    const S = drawnOf(b).S;
    const e = which === 0 ? S[0] : S[S.length - 1];
    const q = which === 0 ? S[1] : S[S.length - 2];
    const dl = Math.hypot(q.x - e.x, q.z - e.z) || 1;
    // Into the deck from the cut, and across it.
    const dx = (q.x - e.x) / dl;
    const dz = (q.z - e.z) / dl;
    const s = (x - e.x) * dx + (z - e.z) * dz;
    const l = (x - e.x) * -dz + (z - e.z) * dx;
    if (Math.abs(l) > half + BRIDGE_MOUTH_FEATHER) continue;
    // The cut line through the end section's center along its axis: its position (along the deck) and
    // its axis parameter at lateral l.
    const al = e.ax * -dz + e.az * dx;
    const as = e.ax * dx + e.az * dz;
    if (Math.abs(al) < 1e-9) continue;
    const k = Math.max(-half, Math.min(half, l / al));
    const depth = as * k - s;
    if (depth < 0 || depth > reach) continue;
    const w = 1 - smoothstep(half, half + BRIDGE_MOUTH_FEATHER, Math.abs(l));
    if (w <= bridgeMouth.weight) continue;
    bridgeMouth.weight = w;
    bridgeMouth.depth = depth;
    bridgeMouth.top = e.y + e.slope * k;
  }
};

/** A landed CUT end's MOUTH as the paint sees it (bridgeMouthFieldAt): the deck's width cut into
 *  MOUTH_COLUMN-wide columns along the deck's direction, and per column how far in front of the cut
 *  line the road's own asphalt begins (−1: not within BRIDGE_MOUTH_DEPTH). What lies between the cut
 *  and that asphalt is what the road ran across the deck's mouth — its curb and sidewalk, a sliver of
 *  sand where the pavement's edge curves away from the straight cut. A column running BESIDE the road
 *  (a deck wider than the road it continues, an oblique landing's corner) never reaches asphalt, so the
 *  road's own curb there stays as it is (painting the whole rectangle in front of the cut would push
 *  the curb out into knobs and steps beside the deck). `lo`: how much of the chunk's
 *  `inward` a column's asphalt reaches under the slab — all of it but near the deck's sides, where the
 *  ground beside the slab would show it. */
interface MouthEnd {
  ex: number;
  ez: number;
  dx: number;
  dz: number;
  /** The cut line's along-deck offset per unit of lateral offset. */
  lean: number;
  reach: Float64Array;
  lo: Float64Array;
  /** The cut's two corners (the end section's outer points). */
  cornerL: PointXZ;
  cornerR: PointXZ;
}
const MOUTH_COLUMN = 1;
/** The road field under which the ground paints as asphalt: the city shader's curb color starts at
 *  ROAD_HALF_WIDTH − 0.3. */
const MOUTH_ASPHALT_EDGE = 6.7;
/** A column's march never steps farther than this (a road field is at most about a distance). */
const MOUTH_MARCH_STEP = 2;
/** …and runs this far past BRIDGE_MOUTH_DEPTH, so asphalt starting right at it is not stepped over. */
const MOUTH_MARCH_SLACK = 0.5;
/** Under the slab the mouth's asphalt narrows to MOUTH_SIDE_BEHIND units inward of the cut over the
 *  last MOUTH_SIDE_TAPER units of the deck's width. */
const MOUTH_SIDE_TAPER = 2;
const MOUTH_SIDE_BEHIND = 1;
const mouthEnds = new WeakMap<FreewayBridge, MouthEnd[]>();
const mouthEndsOf = (b: FreewayBridge, roadField: (x: number, z: number) => number): MouthEnd[] => {
  let ends = mouthEnds.get(b);
  if (ends) return ends;
  ends = [];
  const S = drawnOf(b).S;
  const half = b.width / 2;
  const n = Math.max(1, Math.round(b.width / MOUTH_COLUMN));
  const col = b.width / n;
  for (const which of [0, 1] as const) {
    const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
    const landing = b.landings?.[which];
    if (!axis || !landing || landing.ramp > 0 || S.length < 2) continue;
    const e = which === 0 ? S[0] : S[S.length - 1];
    const q = which === 0 ? S[1] : S[S.length - 2];
    const dl = Math.hypot(q.x - e.x, q.z - e.z) || 1;
    const dx = (q.x - e.x) / dl;
    const dz = (q.z - e.z) / dl;
    const al = e.ax * -dz + e.az * dx;
    if (Math.abs(al) < 1e-9) continue;
    const lean = (e.ax * dx + e.az * dz) / al;
    const reach = new Float64Array(n);
    const lo = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const l = -half + (i + 0.5) * col;
      const at = (depth: number) => roadField(e.x - dz * l + dx * (lean * l - depth), e.z + dx * l + dz * (lean * l - depth));
      let hit = -1;
      let prev = 0;
      for (let depth = 0; depth <= BRIDGE_MOUTH_DEPTH + MOUTH_MARCH_SLACK; ) {
        const f = at(depth);
        if (f < MOUTH_ASPHALT_EDGE) {
          let a0 = prev;
          let a1 = depth;
          for (let it = 0; it < 4 && a1 > a0; it++) {
            const m = (a0 + a1) / 2;
            if (at(m) < MOUTH_ASPHALT_EDGE) a1 = m;
            else a0 = m;
          }
          hit = a1;
          break;
        }
        prev = depth;
        depth += Math.max(0.5, Math.min(MOUTH_MARCH_STEP, f - MOUTH_ASPHALT_EDGE));
      }
      reach[i] = hit;
      lo[i] = Math.min(1, (half - Math.abs(l)) / MOUTH_SIDE_TAPER);
    }
    ends.push({ ex: e.x, ez: e.z, dx, dz, lean, reach, lo, cornerL: { x: e.x + e.ax * e.wl, z: e.z + e.az * e.wl }, cornerR: { x: e.x - e.ax * e.wr, z: e.z - e.az * e.wr } });
  }
  mouthEnds.set(b, ends);
  return ends;
};

/** The road field (street units) a deck's landed CUT ends paint the ground as — Infinity where they
 *  paint nothing; the terrain takes the min of it and its own (computeVertexData step 7e). ASPHALT over
 *  each mouth column (mouthEndsOf) from the cut line to where the road's asphalt begins, and under the
 *  slab `inward` more: every vertex a terrain triangle reaching past the cut line can have (the vertex
 *  fields interpolate, and the slab's own vertices would keep their curb, sidewalk or sand, which the
 *  triangles would draw as a strip across the mouth). A signed DISTANCE field off the mouth's edge,
 *  not a weight (per-vertex weights stepped its edges into the terrain's lattice): the curb color starts
 *  exactly on the edge — in front of the cut, the deck's side line — and climbs MOUTH_CURB_SLOPE per unit
 *  over the curb strip, gentle enough that its line interpolates straight between the terrain's
 *  vertices, then MOUTH_OUTER_SLOPE, so off the mouth the ground's own paint is back within a couple of
 *  units. `roadField` is the ground's own field at a world point (no deck). */
const MOUTH_CURB_SLOPE = 1.5;
const MOUTH_CURB_STRIP = 1.7;
const MOUTH_OUTER_SLOPE = 4;
/** The mouth reaches this far past the deck's sides, so its asphalt still meets the slab's corners
 *  between the terrain's vertices (the curb line interpolates over a triangle). */
const MOUTH_SIDE_OUT = 1.5;
/** Past this the field is nothing the paint (city_frag's last band ends at ROAD_HALF_WIDTH + 7.2) or a
 *  placement filter shows, and the mouth leaves the ground's own field alone. */
const MOUTH_FIELD_MAX = 14.2;
/** The mouth's field `outside` units off its edge: the curb strip, then the ground's paint coming back. */
const edgeField = (outside: number): number => MOUTH_ASPHALT_EDGE + MOUTH_CURB_SLOPE * Math.min(outside, MOUTH_CURB_STRIP) + MOUTH_OUTER_SLOPE * Math.max(0, outside - MOUTH_CURB_STRIP);
export const bridgeMouthFieldAt = (b: FreewayBridge, x: number, z: number, inward: number, asphalt: number, roadField: (x: number, z: number) => number): number => {
  let field = Infinity;
  const half = b.width / 2;
  const edge = MOUTH_ASPHALT_EDGE;
  // Off the mouth by more than `far` the field passes MOUTH_FIELD_MAX; in it by more than `deep`, plain asphalt.
  const far = MOUTH_CURB_STRIP + (MOUTH_FIELD_MAX - edge - MOUTH_CURB_STRIP * MOUTH_CURB_SLOPE) / MOUTH_OUTER_SLOPE;
  const deep = (edge - asphalt) / MOUTH_CURB_SLOPE;
  // Cheap reject before a profile is built: the neighborhood of the deck's end sections.
  const S = drawnOf(b).S;
  const near = (e: BridgeSection) => Math.hypot(x - e.x, z - e.z) < half + BRIDGE_MOUTH_DEPTH * 2 + inward + far;
  if (S.length < 2 || !(near(S[0]) || near(S[S.length - 1]))) return field;
  for (const m of mouthEndsOf(b, roadField)) {
    const cl = m.cornerL;
    const cr = m.cornerR;
    const rx = x - m.ex;
    const rz = z - m.ez;
    const l = rx * -m.dz + rz * m.dx;
    const depth = m.lean * l - (rx * m.dx + rz * m.dz);
    if (Math.abs(l) > half + MOUTH_SIDE_OUT + far || depth > BRIDGE_MOUTH_DEPTH + far || depth < -inward - far) continue;
    const n = m.reach.length;
    const col = b.width / n;
    // Column i's lateral gap to the point (the outer columns reach MOUTH_SIDE_OUT past the deck's sides).
    const gap = (i: number): number => {
      const left = i === 0 ? -half - MOUTH_SIDE_OUT : -half + i * col;
      const right = i === n - 1 ? half + MOUTH_SIDE_OUT : -half + (i + 1) * col;
      return l < left ? left - l : l > right ? l - right : 0;
    };
    const lowOf = (i: number) => -(inward * m.lo[i] + MOUTH_SIDE_BEHIND * (1 - m.lo[i]));
    // Behind the cut line the asphalt keeps off the slab's real SIDE edges: a terrain triangle from there
    // reaches the ground beside the deck, which keeps its own paint. At an oblique cut's ACUTE corner the
    // stretch within `inward` of both the cut and the side runs far along the side (and on a curving deck
    // the mouth's straight columns run out past the side), and its asphalt showed beside the deck as a
    // stepped patch. Within a corner's own square the asphalt runs to the side as before (or the curb
    // would cross the mouth there); beyond it, it keeps `inward` off the side. Off that line the field
    // climbs like the mouth's own edge, eased in over the first unit behind the cut so nothing steps.
    const sideClipped = (f: number, depth: number): number => {
      if (depth >= 0) return f;
      const corner = Math.min(Math.hypot(x - cl.x, z - cl.z), Math.hypot(x - cr.x, z - cr.z));
      const keep = inward * smoothstep(inward, 2 * inward, corner) - bridgeSideIn(b, x, z);
      if (keep <= 0) return f;
      return f + (Math.max(f, edgeField(keep)) - f) * smoothstep(0, 1, -depth);
    };
    // Where the asphalt in front of the cut ends at a lateral offset: between two columns that reach the
    // road's asphalt, interpolated between their centers — per column it stepped 1u sideways at every
    // column, and an oblique road edge in front of the deck came out sawtoothed. A column with none keeps
    // its −1 (beside the road, its curb stays).
    const topAt = (lat: number): number => {
      const own = m.reach[Math.max(0, Math.min(n - 1, Math.floor((lat + half) / col)))];
      const fi = (lat + half) / col - 0.5;
      const i0 = Math.max(0, Math.min(n - 1, Math.floor(fi)));
      const i1 = Math.min(n - 1, i0 + 1);
      if (own < 0 || m.reach[i0] < 0 || m.reach[i1] < 0) return own;
      return m.reach[i0] + (m.reach[i1] - m.reach[i0]) * Math.max(0, Math.min(1, fi - i0));
    };
    // How far column i's asphalt lies from the point along the deck (0: the point is in it; Infinity: none).
    const off = (i: number): number => {
      if (m.reach[i] < 0) return Infinity;
      const top = topAt(Math.max(-half + i * col, Math.min(-half + (i + 1) * col, l)));
      const lo = lowOf(i);
      return depth < lo ? lo - depth : depth > top ? depth - top : 0;
    };
    const c = Math.max(0, Math.min(n - 1, Math.floor((l + half) / col)));
    const span = Math.ceil(Math.max(far, deep) / col) + 1;
    if (gap(c) === 0 && off(c) === 0) {
      // In the mouth: how deep, to its nearest edge (the deck's side, the column's ends, a column beside
      // it whose asphalt does not reach this depth).
      let inside = Math.min(half + MOUTH_SIDE_OUT - Math.abs(l), depth - lowOf(c), topAt(Math.max(-half, Math.min(half, l))) - depth);
      for (let j = Math.max(0, c - span); j <= Math.min(n - 1, c + span); j++) {
        // A column beside the road bounds the mouth sideways; one that reaches the road's asphalt does
        // through topAt (by its own top, the curb came back a column wide at every step of the tops).
        if (m.reach[j] < 0) inside = Math.min(inside, Math.max(0, Math.abs(l - (-half + (j + 0.5) * col)) - col / 2));
      }
      field = Math.min(field, sideClipped(Math.max(asphalt, edge - MOUTH_CURB_SLOPE * inside), depth));
      continue;
    }
    let outside = Infinity;
    for (let j = Math.max(0, c - span); j <= Math.min(n - 1, c + span); j++) {
      const o = off(j);
      if (Number.isFinite(o)) outside = Math.min(outside, Math.hypot(gap(j), o));
    }
    if (outside < far) field = Math.min(field, sideClipped(edgeField(outside), depth));
  }
  return field;
};

/** A landed end's APPROACH (computeVertexData step 7): the road in front of the end section — out to
 *  `front`, fading over `fade` — where the road is laid at its own grade, flat across, instead of giving
 *  way to the river (VertexResult.approachHeight). `bridgeApproach.weight` is 1 there, fading over
 *  APPROACH_SIDE_FADE from APPROACH_SIDE past the deck's sides (the approach's shoulder lies within it, and
 *  past it the road and the ground it gives way to are one) and over `fade` inward of the end's line past
 *  a ramp and `margin` (the slab's own cut and fill take over there); `depth` is how far in front of
 *  that end's line (negative inward). */
export const bridgeApproach = { weight: 0, depth: 0 };
const APPROACH_SIDE = 26;
const APPROACH_SIDE_FADE = 8;
export const bridgeApproachAt = (b: FreewayBridge, x: number, z: number, margin: number, front: number, fade: number): void => {
  bridgeApproach.weight = 0;
  const half = b.width / 2;
  for (const which of [0, 1] as const) {
    const landing = b.landings?.[which];
    if (!landing) continue;
    const S = drawnOf(b).S;
    if (S.length < 2) return;
    const e = which === 0 ? S[0] : S[S.length - 1];
    const q = which === 0 ? S[1] : S[S.length - 2];
    const dl = Math.hypot(q.x - e.x, q.z - e.z) || 1;
    const dx = (q.x - e.x) / dl;
    const dz = (q.z - e.z) / dl;
    const s = (x - e.x) * dx + (z - e.z) * dz;
    const l = (x - e.x) * -dz + (z - e.z) * dx;
    const side = 1 - smoothstep(half + APPROACH_SIDE, half + APPROACH_SIDE + APPROACH_SIDE_FADE, Math.abs(l));
    if (side <= bridgeApproach.weight) continue;
    const al = e.ax * -dz + e.az * dx;
    const as = e.ax * dx + e.az * dz;
    if (Math.abs(al) < 1e-9) continue;
    const depth = as * Math.max(-half, Math.min(half, l / al)) - s;
    // Inward over the ramp and the margin (the terrain triangles across the seam), fading as in front.
    const inward = Math.min(b.length / 2 - fade, landing.ramp + margin);
    const along = depth >= 0 ? 1 - smoothstep(front, front + fade, depth) : 1 - smoothstep(inward, inward + fade, -depth);
    if (side * along <= bridgeApproach.weight) continue;
    bridgeApproach.weight = side * along;
    bridgeApproach.depth = depth;
  }
};
