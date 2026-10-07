/** The road in front of a deck's LANDED end (computeVertexData step 7): its approach, laid flat at
 *  its own grade, and a cut end's MOUTH — the asphalt between the cut and the road it lands on, at the
 *  slab's height and painted as road. Read against the drawn slab (drawnSlab.ts). */

import { smoothstep } from "../../math/_math";
import type { PointXZ } from "../../math/types";
import { bridgeSideIn, drawnOf } from "./drawnSlab";
import type { BridgeSection, FreewayBridge } from "./types";

/** The MOUTH of a landed CUT end: the stretch of its road between the road's centerline (the deck
 *  path's end) and the cut, across the deck's width, where the road's curb and sidewalk would run across
 *  the deck's mouth as a step up onto a slab starting at the sidewalk's height. There the road is ASPHALT at
 *  the asphalt's height: computeVertexData lowers the curb's rise out of the ground and paints the field
 *  as road, and the deck's cut end starts on that asphalt (landedCut).
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
