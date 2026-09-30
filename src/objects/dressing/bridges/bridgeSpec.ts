import type { DressingColliderMesh, DressingColliderPart, DressingColliderSpec } from "../types";
import {
  type BridgePlacementParams,
  type BridgeSection,
  type FreewayBridge,
  BRIDGE_PARAPET_WIDTH,
  bridgeLaneAlong,
  bridgePaintAt,
  bridgeDrawnTopAt,
  bridgeParapetAt,
  bridgeSections,
  DEFAULT_BRIDGE_PLACEMENT,
} from "../../../utils/workers/vertexCompute";

// Three-free: the deck art (Bridges.tsx), the client colliders AND the server's
// (physics/obstacles.ts) are all built from these — from ONE set of stations, so every
// collider box lies exactly under the wall or slab it stands for.

// The deck's width, its sections and its parapet gaps come with the deck (FreewayBridge, from the
// enumerator in utils/workers/bridges/); what lives here is the art and the boxes.
export const BRIDGE_DECK_THICKNESS = 1.4;
export const BRIDGE_PARAPET_HEIGHT = 1.1;
export const BRIDGE_PIER_SIZE = 1.8;
/** A column the deck clears by less than this is not built. */
const BRIDGE_PIER_MIN_HEIGHT = 0.5;
/** A parapet lower than this where the ramp raises it out of the ground has no collider. */
const BRIDGE_WALL_MIN_HEIGHT = 0.05;

/** The city biome's <Bridges/> mount uses these defaults, and so do the server and the terrain's cut
 *  under the decks (computeVertexData) — a mount overriding them would draw decks the ground was
 *  not cut for. */
export const BRIDGE_PLACEMENT: BridgePlacementParams = DEFAULT_BRIDGE_PLACEMENT;

export interface BridgePierColumn {
  x: number;
  z: number;
  groundY: number;
  topY: number;
}

/** A point `lateral` units across a section (+ = left) on the deck top. */
const across = (s: BridgeSection, lateral: number): [number, number, number] => [s.x + s.ax * lateral, s.y + s.slope * lateral, s.z + s.az * lateral];


export interface BridgeColliderPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
  parts: DressingColliderPart[];
  mesh: DressingColliderMesh;
}

/** The deck's colliders: one fixed body per chord between consecutive sections, at the chord's middle
 *  (unrotated), carrying a TRIANGLE MESH of exactly what the ribbon draws there — the slab's top (split
 *  along the ribbon's own diagonal), its underside and edges, and each STANDING parapet as a closed
 *  prism with a cap wherever it starts or stops. Pitched boxes per chord could not follow a slab that
 *  cross-falls and twists between two sections (a landed end on a hillside, an oblique cut, a fillet):
 *  MEASURED 8% of the drawn top more than 0.1u off its box, up to 6.7u — players fell through (Evan,
 *  74.png). What the client's <Bridges/> and the server's obstacles both mount. */
export const bridgeColliderPoints = (b: FreewayBridge): BridgeColliderPoint[] => {
  const sections = bridgeSections(b);
  const T = BRIDGE_DECK_THICKNESS;
  const PW = BRIDGE_PARAPET_WIDTH;
  const n = sections.length;
  const out: BridgeColliderPoint[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = sections[i];
    const c = sections[i + 1];
    if (Math.hypot(c.x - a.x, c.z - a.z) < 1e-3) continue;
    const mx = (a.x + c.x) / 2;
    const my = (a.y + c.y) / 2;
    const mz = (a.z + c.z) / 2;
    const vertices: number[] = [];
    const indices: number[] = [];
    const vert = (p: number[]): number => {
      vertices.push(p[0] - mx, p[1] - my, p[2] - mz);
      return vertices.length / 3 - 1;
    };
    const tri = (p: number[], q: number[], r: number[]) => indices.push(vert(p), vert(q), vert(r));
    const quad = (p: number[], q: number[], r: number[], s: number[]) => {
      tri(p, q, r);
      tri(p, r, s);
    };
    const lift = (p: number[], up: number): number[] => [p[0], p[1] + up, p[2]];
    const aL = across(a, a.wl), aR = across(a, -a.wr), cL = across(c, c.wl), cR = across(c, -c.wr);
    // The top as the ribbon splits it, the underside, the slab's two edges.
    quad(aL, aR, cR, cL);
    quad(lift(aL, -T), lift(aR, -T), lift(cR, -T), lift(cL, -T));
    const tm = (a.t + c.t) / 2;
    for (const side of [1, -1] as const) {
      const wa = side === 1 ? a.wl : a.wr;
      const wc = side === 1 ? c.wl : c.wr;
      const ao = across(a, side * wa);
      const co = across(c, side * wc);
      const standing = bridgeParapetAt(b, tm, side);
      const ha = standing ? BRIDGE_PARAPET_HEIGHT * a.wall : 0;
      const hc = standing ? BRIDGE_PARAPET_HEIGHT * c.wall : 0;
      const wall = standing && (ha + hc) / 2 >= BRIDGE_WALL_MIN_HEIGHT;
      quad(lift(ao, -T), lift(ao, wall ? ha : 0), lift(co, wall ? hc : 0), lift(co, -T));
      if (!wall) continue;
      const ai = across(a, side * (wa - PW));
      const ci = across(c, side * (wc - PW));
      quad(ai, lift(ai, ha), lift(ci, hc), ci);
      quad(lift(ai, ha), lift(ao, ha), lift(co, hc), lift(ci, hc));
      if (i === 0 || !bridgeParapetAt(b, (sections[i - 1].t + a.t) / 2, side)) quad(ai, ao, lift(ao, ha), lift(ai, ha));
      if (i + 2 === n || !bridgeParapetAt(b, (c.t + sections[i + 2].t) / 2, side)) quad(ci, co, lift(co, hc), lift(ci, hc));
    }
    out.push({ x: mx, y: my, z: mz, yaw: 0, parts: [], mesh: { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) } });
  }
  return out;
};

/** A column pair per pier station, from the channel floor to the DRAWN slab's underside — the lowest
 *  over the column's footprint, the ribbon's own triangles (cross-falls, twists and ramps included):
 *  from the deck's centerline height plus the ramp alone, columns stood up through a cross-falling
 *  slab's low side (Evan, 73.png). */
export const bridgePierColumns = (b: FreewayBridge): BridgePierColumn[] => {
  const out: BridgePierColumn[] = [];
  const h = BRIDGE_PIER_SIZE / 2;
  for (const p of b.piers) {
    for (const side of [1, -1]) {
      const lateral = side * BRIDGE_PLACEMENT.pierLateral;
      const x = p.x - p.dirZ * lateral;
      const z = p.z + p.dirX * lateral;
      let top = Infinity;
      for (const [dx, dz] of PIER_FOOTPRINT) top = Math.min(top, bridgeDrawnTopAt(b, x + dx * h, z + dz * h));
      if (!Number.isFinite(top)) continue;
      const topY = top - BRIDGE_DECK_THICKNESS;
      if (topY - p.groundY <= BRIDGE_PIER_MIN_HEIGHT) continue;
      out.push({ x, z, groundY: p.groundY, topY });
    }
  }
  return out;
};
const PIER_FOOTPRINT = [
  [0, 0],
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

export interface BridgeRibbonBuffers {
  positions: number[];
  /** The SHADING normal: straight up on the road surface, so every piece of a junction — pitched a
   *  little differently — shades exactly like the flat terrain road it continues (a lit per-face
   *  normal drew a line at every seam). */
  normals: number[];
  colors: number[];
  /** Road texture coordinates: world x/z ÷ 26.25 relative to a WORLD_WRAP multiple, so the tile
   *  phase is the terrain's. */
  uvs: number[];
  /** Per vertex: lateral offset from the centerline (real units), lane-dash phase, lane paint (0/1),
   *  road surface (on the deck top 1, or 2 along an edge whose wall is open — no gutter there, the road
 *  goes on; 0 on walls and the underside). */
  road: number[];
}

/** Only where the road texture is not drawn (it is, on the top): the fallback asphalt tone. */
const DECK_TOP_COLOR = [0.16, 0.16, 0.18];
const DECK_UNDER_COLOR = [0.36, 0.36, 0.35];
const DECK_SIDE_COLOR = [0.52, 0.52, 0.5];
const PARAPET_COLOR = [0.62, 0.62, 0.6];
/** A T end's slab top — its cut section and the crotch fillets beside it, where the child lies over its
 *  host — is DRAWN this far under the host's: the two surfaces coincide there, and the depth test fought
 *  over them as a faint line across the merged road (Evan, screenshot). Render-only: the colliders and
 *  the terrain cut keep the true sections. */
const TEE_TOP_DROP = 0.02;
/** The terrain's road texture repeat (world units per tile) — vertex.glsl's vWorldUv. */
const ROAD_UV_SCALE = 26.25;

/** Appends the deck — slab + standing parapets lofted along its sections, mitered at the path's
 *  vertices, a T end cut along its host's edge — as flat triangles relative to (ox, oy, oz);
 *  `uvx`/`uvz` are the world coordinates of the uv origin (a WORLD_WRAP multiple). One continuous
 *  ribbon: instanced chords read as segments shoved together. */
export const bridgeRibbon = (b: FreewayBridge, ox: number, oy: number, oz: number, uvx: number, uvz: number, out: BridgeRibbonBuffers): void => {
  const sections = bridgeSections(b);
  const n = sections.length;
  if (n < 2) return;
  const T = BRIDGE_DECK_THICKNESS;
  const PH = BRIDGE_PARAPET_HEIGHT;
  const PW = BRIDGE_PARAPET_WIDTH;
  const along = sections.map((s) => bridgeLaneAlong(b, s.t));
  // The material reads road bands at freeway-normalized offsets; a street deck scales its own.
  const laneScale = b.laneScale ?? 1;
  // A vertex: world point `p` relative to the origin, with its shading normal, color and road data.
  const vert = (p: number[], normal: number[], color: number[], lateral: number, dash: number, paint: number, surface: number) => {
    out.positions.push(p[0] - ox, p[1] - oy, p[2] - oz);
    out.normals.push(normal[0], normal[1], normal[2]);
    out.colors.push(color[0], color[1], color[2]);
    out.uvs.push((p[0] - uvx) / ROAD_UV_SCALE, (p[2] - uvz) / ROAD_UV_SCALE);
    out.road.push(lateral, dash, paint, surface);
  };
  // A quad of four [point, lateral, dash] corners facing `hint`; flat-shaded unless `normal` is given.
  type Corner = [number[], number, number, number?];
  const quad = (c: Corner[], hint: number[], color: number[], surface: number, paint = 0, normal?: number[]) => {
    // A wall rising out of the ground at a ramp's end has a zero-height edge: take the face from the other triangle.
    const degenerate = Math.hypot(c[1][0][0] - c[0][0][0], c[1][0][1] - c[0][0][1], c[1][0][2] - c[0][0][2]) < 1e-6;
    const [p0, p1, p2] = degenerate ? [c[0][0], c[2][0], c[3][0]] : [c[0][0], c[1][0], c[2][0]];
    const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
    const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-9) return;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    let order = [0, 1, 2, 0, 2, 3];
    if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) {
      order = [0, 2, 1, 0, 3, 2];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    for (const k of order) vert(c[k][0], normal ?? [nx, ny, nz], color, c[k][1], c[k][2], paint, c[k][3] ?? surface);
  };
  const lift = (p: number[], up: number): number[] => [p[0], p[1] + up, p[2]];
  // The sections a T end lays over its host: the cut's, and the fillet rows widened past the deck's half.
  const half = b.width / 2;
  const overHost = sections.map(() => false);
  for (const which of [0, 1] as const) {
    if (!(which === 0 ? b.trimStartAxis : b.trimEndAxis) || b.landings?.[which]) continue;
    for (let k = 0; k < n; k++) {
      const i = which === 0 ? k : n - 1 - k;
      const q = sections[i];
      if (k > 0 && q.wl <= half + 1e-6 && q.wr <= half + 1e-6) break;
      overHost[i] = true;
    }
  }
  const topAt = (i: number, lateral: number): number[] => lift(across(sections[i], lateral), overHost[i] ? -TEE_TOP_DROP : 0);
  const up = [0, 1, 0];
  const down = [0, -1, 0];
  for (let i = 0; i + 1 < n; i++) {
    const a = sections[i];
    const c = sections[i + 1];
    const tm = (a.t + c.t) / 2;
    const paint = bridgePaintAt(b, tm) ? 1 : 0;
    const aL = across(a, a.wl), aR = across(a, -a.wr), cL = across(c, c.wl), cR = across(c, -c.wr);
    // Where a side's wall is open the road runs on past that edge (another deck, a road): no gutter
    // there (the host's gutter ran across a Y's mouth as a dark seam — Evan, screenshot).
    const gutterL = bridgeParapetAt(b, tm, 1) ? 1 : 2;
    const gutterR = bridgeParapetAt(b, tm, -1) ? 1 : 2;
    quad([[topAt(i, a.wl), a.wl * laneScale, along[i], gutterL], [topAt(i, -a.wr), -a.wr * laneScale, along[i], gutterR], [topAt(i + 1, -c.wr), -c.wr * laneScale, along[i + 1], gutterR], [topAt(i + 1, c.wl), c.wl * laneScale, along[i + 1], gutterL]], up, DECK_TOP_COLOR, 1, paint, up);
    quad([[lift(aL, -T), 0, 0], [lift(aR, -T), 0, 0], [lift(cR, -T), 0, 0], [lift(cL, -T), 0, 0]], down, DECK_UNDER_COLOR, 0);
    const tangent = [c.x - a.x, 0, c.z - a.z];
    for (const side of [1, -1] as const) {
      const wa = side === 1 ? a.wl : a.wr;
      const wc = side === 1 ? c.wl : c.wr;
      const outward = [a.ax * side, 0, a.az * side];
      const inward = [-outward[0], 0, -outward[2]];
      const parapet = bridgeParapetAt(b, tm, side);
      // The wall's height at each section: full, or rising out of the ground along a landed end's ramp.
      const ha = parapet ? PH * a.wall : 0;
      const hc = parapet ? PH * c.wall : 0;
      const ao = across(a, side * wa), co = across(c, side * wc);
      quad([[lift(ao, -T), 0, 0], [lift(ao, ha), 0, 0], [lift(co, hc), 0, 0], [lift(co, -T), 0, 0]], outward, DECK_SIDE_COLOR, 0);
      if (!parapet || ha + hc < 1e-3) continue;
      const ai = across(a, side * (wa - PW)), ci = across(c, side * (wc - PW));
      quad([[ai, 0, 0], [lift(ai, ha), 0, 0], [lift(ci, hc), 0, 0], [ci, 0, 0]], inward, PARAPET_COLOR, 0);
      quad([[lift(ai, ha), 0, 0], [lift(ao, ha), 0, 0], [lift(co, hc), 0, 0], [lift(ci, hc), 0, 0]], up, PARAPET_COLOR, 0);
      // Cap the wall wherever it starts or stops standing (deck ends, both sides of a gap).
      if (ha > 1e-3 && (i === 0 || !bridgeParapetAt(b, (sections[i - 1].t + a.t) / 2, side))) {
        quad([[ai, 0, 0], [ao, 0, 0], [lift(ao, ha), 0, 0], [lift(ai, ha), 0, 0]], [-tangent[0], 0, -tangent[2]], PARAPET_COLOR, 0);
      }
      if (hc > 1e-3 && (i + 2 === n || !bridgeParapetAt(b, (c.t + sections[i + 2].t) / 2, side))) {
        quad([[ci, 0, 0], [co, 0, 0], [lift(co, hc), 0, 0], [lift(ci, hc), 0, 0]], tangent, PARAPET_COLOR, 0);
      }
    }
  }
  // Slab end faces.
  for (const [i, k] of [[0, 1], [n - 1, n - 2]]) {
    const s = sections[i];
    const o = [s.x - sections[k].x, 0, s.z - sections[k].z];
    const L = across(s, s.wl), R = across(s, -s.wr);
    quad([[lift(L, -T), 0, 0], [lift(R, -T), 0, 0], [R, 0, 0], [L, 0, 0]], o, DECK_SIDE_COLOR, 0);
  }
};

/** Every chord body carries its own mesh, so there are no shared parts. */
export const BRIDGES_SPEC: DressingColliderSpec<"bridges"> = {
  id: "Bridges",
  enumerator: "bridges",
  placement: BRIDGE_PLACEMENT,
  colliderParts: [],
  bodiesOf: bridgeColliderPoints,
};
