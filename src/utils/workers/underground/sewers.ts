/**
 * The sewer generator: one system per city cell that passes its roll (systems.ts), laid out on the
 * cell's district's block lattice in WORLD space (the city's blocks are: getCityTerrain gets the raw
 * position). Systems of one district MERGE into one layout, which everything drawn comes from.
 * Three-free.
 */

import { seededStream, type SeededStream } from "../../math/seededStream";
import type { PointXZ } from "../../math/types";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { riverKeepOff } from "../rivers/constants";
import { cityLocalToWorld, getCityDistrict, type CityDistrict } from "../roads/cityDistricts";
import { computeVertexData } from "../vertexCompute";
import {
  CHANNEL_DEPTH,
  COVER_CLEARANCE,
  COVER_FIT_POINTS,
  COVER_RADIUS,
  DOOR_CHANCE,
  DOOR_HEIGHT,
  DOOR_WIDTH,
  FRAME_INNER_RADIUS,
  FRAME_OUTER_RADIUS,
  FRAME_SAMPLES,
  FRAME_TOP_OVER_GROUND,
  JUNCTION_HALF,
  JUNCTION_HEIGHT,
  LOOP_FALLBACK_STREETS,
  LOOP_LEAD_STREETS_MAX,
  LOOP_LEAD_STREETS_MIN,
  MANHOLE_ASIDE_OUT,
  MANHOLE_EXIT_OUT,
  PIPE_AXIS_LIFT,
  PIPE_RADIUS,
  POOL_DEPTH,
  REVEAL_DEPTH,
  ROCK_COVER,
  ROOM_CHANCE,
  ROOM_HALF,
  ROOM_HEIGHT,
  ROOM_WALKWAY,
  SEWER_BRANCH_LENGTH_MAX,
  SEWER_BRANCH_LENGTH_MIN,
  SEWER_BRANCH_MAX,
  SEWER_BRANCH_MIN,
  SEWER_DEPTH,
  SEWER_LATTICE_REACH,
  SEWER_NODE_ROAD_FIELD,
  SEWER_STREET_SAMPLE,
  SHAFT_CEILING_OVERLAP,
  SHAFT_CORNER_IN,
  SHAFT_RADIUS,
  SIDE_ROOM_CLEAR,
  SIDE_ROOM_HALF,
  SIDE_ROOM_HEIGHT,
  SIDE_ROOM_HEIGHTS,
  SIDE_ROOM_SAMPLE,
  STRAIGHT_ON_CHANCE,
  THROUGH_CHANCE,
  THROUGH_FALLBACK_MIN,
  THROUGH_MAX,
  THROUGH_MIN,
} from "./constants";
import { restingGroundAt } from "./drawnGround";
import { compileField, emptyBounds, growBounds, type PipeWalkway, withBounds } from "./tunnelField";
import type { BoxPiece, DiscPose, ManholeInfo, PipePiece, SewerDoor, ShaftPiece, SkirtMask, TunnelEntrance, TunnelPiece, TunnelSystem } from "./types";

/** Lattice directions: +i, +j, −i, −j. */
export const SEWER_DIRS: readonly [number, number][] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

/** The ring a LOOP layout tries around its lead, in w × h blocks, and the turns it tries each in. */
const RING_SIZES: readonly [number, number][] = [
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
];
const RING_TURNS: readonly number[] = [1, -1];

type LatticeCell = [number, number];

export interface SewerNode {
  key: string;
  i: number;
  j: number;
  x: number;
  z: number;
  street: number;
  floor: number;
  /** A street leaves on this side (SEWER_DIRS order). */
  links: [boolean, boolean, boolean, boolean];
  room: boolean;
  manhole: boolean;
  /** The shaft's floor corner (±1, ±1) in lattice axes. */
  manholeCorner: [number, number];
  /** The side (SEWER_DIRS index) with a door, or −1. */
  door: number;
  manholeInfo: ManholeInfo | null;
}

export interface SewerStreet {
  a: string;
  b: string;
}

export interface SewerLayout {
  key: string;
  district: CityDistrict;
  nodes: Map<string, SewerNode>;
  streets: SewerStreet[];
}

/** A sewer system keeps its layout: the district's systems merge by layout (mergeLayouts). */
export interface SewerSystem extends TunnelSystem {
  layout: SewerLayout;
}
export const isSewerSystem = (s: TunnelSystem): s is SewerSystem => s.style === "sewer";

const nodeKey = (i: number, j: number): string => `${i},${j}`;
const streetKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const cellKey = (c: LatticeCell): string => nodeKey(c[0], c[1]);
const stepKey = (from: LatticeCell, to: LatticeCell): string => streetKey(cellKey(from), cellKey(to));

/** The district's lattice axes in the world: local x and local z as unit vectors. */
export const districtAxes = (d: CityDistrict): { ex: PointXZ; ez: PointXZ } => ({ ex: { x: d.cos, z: d.sin }, ez: { x: -d.sin, z: d.cos } });

const latticeWorld = (d: CityDistrict, i: number, j: number): PointXZ => {
  const gs = domainConfig!.cityConfig.gridSize;
  return cityLocalToWorld(i * gs, j * gs, d);
};

export const boxHalf = (node: SewerNode): number => (node.room ? ROOM_HALF : JUNCTION_HALF);
export const boxHeight = (node: SewerNode): number => (node.room ? ROOM_HEIGHT : JUNCTION_HEIGHT);
export const poolHalf = ROOM_HALF - ROOM_WALKWAY;

/** The SEWER_DIRS index of the step from one lattice cell to its neighbour. */
const dirBetween = (from: LatticeCell, to: LatticeCell): number => SEWER_DIRS.findIndex(([di, dj]) => di === to[0] - from[0] && dj === to[1] - from[1]);

/** On-street ground for a sewer: in the biome, near a road's center, dry, clear of rivers and decks. */
const onStreet = (x: number, z: number, biomeId: number): boolean => {
  const vd = computeVertexData(x, z);
  return (
    vd.biomeId === biomeId &&
    vd.distanceToRoadCenter <= SEWER_NODE_ROAD_FIELD &&
    vd.distanceToRiverCenter >= riverKeepOff() &&
    !(vd.waterHeight > vd.height) &&
    vd.underDeck === 0
  );
};

// ── The lattice ───────────────────────────────────────────────────────────

/** The lattice of a district as the generator sees it: nodes and streets within reach of the start,
 *  each judged once. */
interface Lattice {
  nodeUsable(i: number, j: number): boolean;
  streetUsable(i: number, j: number, dir: number): boolean;
}

const latticeOf = (d: CityDistrict, i0: number, j0: number, biomeId: number): Lattice => {
  const nodes = new Map<string, boolean>();
  const streets = new Map<string, boolean>();
  const nodeUsable = (i: number, j: number): boolean => {
    if (Math.abs(i - i0) > SEWER_LATTICE_REACH || Math.abs(j - j0) > SEWER_LATTICE_REACH) return false;
    const k = nodeKey(i, j);
    let v = nodes.get(k);
    if (v === undefined) {
      const p = latticeWorld(d, i, j);
      v = onStreet(p.x, p.z, biomeId);
      nodes.set(k, v);
    }
    return v;
  };
  /** A street is usable where every SEWER_STREET_SAMPLE of it is on-street and the ground keeps
   *  ROCK_COVER over the pipe's crown. */
  const streetUsable = (i: number, j: number, dir: number): boolean => {
    const ni = i + SEWER_DIRS[dir][0];
    const nj = j + SEWER_DIRS[dir][1];
    const k = streetKey(nodeKey(i, j), nodeKey(ni, nj));
    let v = streets.get(k);
    if (v === undefined) {
      v = false;
      if (nodeUsable(i, j) && nodeUsable(ni, nj)) {
        const a = latticeWorld(d, i, j);
        const b = latticeWorld(d, ni, nj);
        const floorA = computeVertexData(a.x, a.z).height - SEWER_DEPTH;
        const floorB = computeVertexData(b.x, b.z).height - SEWER_DEPTH;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        v = true;
        for (let s = SEWER_STREET_SAMPLE; s < len; s += SEWER_STREET_SAMPLE) {
          const t = s / len;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          if (!onStreet(x, z, biomeId)) {
            v = false;
            break;
          }
          const crown = floorA + (floorB - floorA) * t + PIPE_AXIS_LIFT + PIPE_RADIUS;
          if (computeVertexData(x, z).height - crown < ROCK_COVER) {
            v = false;
            break;
          }
        }
      }
      streets.set(k, v);
    }
    return v;
  };
  return { nodeUsable, streetUsable };
};

const hasUsableStreet = (lattice: Lattice, i: number, j: number): boolean => {
  for (let dir = 0; dir < 4; dir++) if (lattice.streetUsable(i, j, dir)) return true;
  return false;
};

/** The intersection nearest the cell's site, in lattice indices. */
const latticeOrigin = (d: CityDistrict, site: PointXZ): LatticeCell => {
  const gs = domainConfig!.cityConfig.gridSize;
  const rdx = site.x - d.px;
  const rdz = site.z - d.pz;
  const lx = d.px + rdx * d.cos + rdz * d.sin;
  const lz = d.pz - rdx * d.sin + rdz * d.cos;
  return [Math.round(lx / gs), Math.round(lz / gs)];
};

/** The start: the nearest intersection or one of its eight neighbours, with a street to walk. */
const findStart = (lattice: Lattice, [i0, j0]: LatticeCell): LatticeCell | null => {
  const candidates: LatticeCell[] = [[i0, j0]];
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) if (di !== 0 || dj !== 0) candidates.push([i0 + di, j0 + dj]);
  for (const c of candidates) if (lattice.nodeUsable(c[0], c[1]) && hasUsableStreet(lattice, c[0], c[1])) return c;
  return null;
};

// ── Walking the lattice ───────────────────────────────────────────────────

/** Walks a path of up to `count` streets from `start`: straight on with STRAIGHT_ON_CHANCE where it
 *  can (or, `preferTurn`, any turn first), else a random usable unvisited street; stops when none is
 *  left. Marks what it visits and uses. */
const walk = (lattice: Lattice, start: LatticeCell, count: number, visited: Set<string>, used: Set<string>, stream: SeededStream, preferTurn: boolean): LatticeCell[] => {
  const path: LatticeCell[] = [start];
  visited.add(cellKey(start));
  let prev = -1;
  let [i, j] = start;
  for (let step = 0; step < count; step++) {
    const options: number[] = [];
    for (let dir = 0; dir < 4; dir++) {
      const ni = i + SEWER_DIRS[dir][0];
      const nj = j + SEWER_DIRS[dir][1];
      if (visited.has(nodeKey(ni, nj)) || !lattice.streetUsable(i, j, dir)) continue;
      options.push(dir);
    }
    if (options.length === 0) break;
    let dir: number;
    const turns = options.filter((o) => o !== prev);
    if (preferTurn && turns.length > 0) dir = stream.pick(turns);
    else if (prev >= 0 && options.includes(prev) && stream.next() < STRAIGHT_ON_CHANCE) dir = prev;
    else dir = stream.pick(options);
    const ni = i + SEWER_DIRS[dir][0];
    const nj = j + SEWER_DIRS[dir][1];
    used.add(streetKey(nodeKey(i, j), nodeKey(ni, nj)));
    visited.add(nodeKey(ni, nj));
    path.push([ni, nj]);
    i = ni;
    j = nj;
    prev = dir;
  }
  return path;
};

/** A ring around a w×h block rectangle from `from` heading `dir`, turning `turn` (±1) at each corner,
 *  over unused usable streets: its nodes (back to `from`), or null. */
const tryRing = (lattice: Lattice, from: LatticeCell, dir: number, w: number, h: number, turn: number, used: Set<string>): LatticeCell[] | null => {
  const nodes: LatticeCell[] = [from];
  let [i, j] = from;
  let d = dir;
  const legs = [w, h, w, h];
  const seen = new Set<string>();
  for (let leg = 0; leg < 4; leg++) {
    for (let s = 0; s < legs[leg]; s++) {
      if (!lattice.streetUsable(i, j, d)) return null;
      const ni = i + SEWER_DIRS[d][0];
      const nj = j + SEWER_DIRS[d][1];
      const sk = streetKey(nodeKey(i, j), nodeKey(ni, nj));
      if (used.has(sk) || seen.has(sk)) return null;
      seen.add(sk);
      i = ni;
      j = nj;
      nodes.push([i, j]);
    }
    d = (d + turn + 4) % 4;
  }
  if (i !== from[0] || j !== from[1]) return null;
  return nodes;
};

/** The main path: a THROUGH walk of THROUGH_MIN–THROUGH_MAX streets (THROUGH_CHANCE; falling back when
 *  shorter than THROUGH_FALLBACK_MIN), else a LOOP: a short lead, then a ring around a block rectangle
 *  from its end, or LOOP_FALLBACK_STREETS more of walking when no ring fits. */
const walkMainPath = (lattice: Lattice, start: LatticeCell, stream: SeededStream, visited: Set<string>, used: Set<string>): { main: LatticeCell[]; through: boolean } => {
  let through = stream.next() < THROUGH_CHANCE;
  if (through) {
    const main = walk(lattice, start, stream.intBetween(THROUGH_MIN, THROUGH_MAX), visited, used, stream, false);
    if (main.length - 1 >= THROUGH_FALLBACK_MIN) return { main, through };
    through = false;
    visited.clear();
    used.clear();
  }
  const lead = walk(lattice, start, stream.intBetween(LOOP_LEAD_STREETS_MIN, LOOP_LEAD_STREETS_MAX), visited, used, stream, false);
  let ring: LatticeCell[] | null = null;
  if (lead.length > 1) {
    const last = lead[lead.length - 1];
    const dir = dirBetween(lead[lead.length - 2], last);
    const sizes = stream.shuffled(RING_SIZES);
    const turns = stream.shuffled(RING_TURNS);
    for (const [w, h] of sizes) {
      for (const turn of turns) {
        ring = tryRing(lattice, last, dir, w, h, turn, used);
        if (ring) break;
      }
      if (ring) break;
    }
  }
  if (ring) {
    for (let k = 1; k < ring.length; k++) {
      used.add(stepKey(ring[k - 1], ring[k]));
      visited.add(cellKey(ring[k]));
    }
    return { main: lead.concat(ring.slice(1)), through };
  }
  const more = walk(lattice, lead[lead.length - 1], LOOP_FALLBACK_STREETS, visited, used, stream, false);
  return { main: lead.concat(more.slice(1)), through };
};

// ── The graph ─────────────────────────────────────────────────────────────

const makeNode = (d: CityDistrict, i: number, j: number): SewerNode => {
  const p = latticeWorld(d, i, j);
  const street = computeVertexData(p.x, p.z).height;
  return { key: nodeKey(i, j), i, j, x: p.x, z: p.z, street, floor: street - SEWER_DEPTH, links: [false, false, false, false], room: false, manhole: false, manholeCorner: [1, 1], door: -1, manholeInfo: null };
};

/** The nodes and streets a layout collects as paths are linked into it. */
interface SewerGraph {
  nodes: Map<string, SewerNode>;
  streets: SewerStreet[];
  nodeAt(i: number, j: number): SewerNode;
  /** Links every consecutive pair of a path (a street already linked stays one). */
  linkPath(path: readonly LatticeCell[]): void;
}

const sewerGraph = (d: CityDistrict): SewerGraph => {
  const nodes = new Map<string, SewerNode>();
  const streets: SewerStreet[] = [];
  const nodeAt = (i: number, j: number): SewerNode => {
    const k = nodeKey(i, j);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = makeNode(d, i, j)));
    return n;
  };
  const link = (a: LatticeCell, b: LatticeCell): void => {
    const na = nodeAt(a[0], a[1]);
    const nb = nodeAt(b[0], b[1]);
    const dir = dirBetween(a, b);
    if (na.links[dir]) return;
    na.links[dir] = true;
    nb.links[(dir + 2) % 4] = true;
    streets.push({ a: na.key, b: nb.key });
  };
  return {
    nodes,
    streets,
    nodeAt,
    linkPath: (path) => {
      for (let k = 1; k < path.length; k++) link(path[k - 1], path[k]);
    },
  };
};

/** Node kinds along the main path: manholes on every second node (and a through path's far end), the
 *  others a room with ROOM_CHANCE. Returns the main nodes, each once. */
const assignNodeKinds = (graph: SewerGraph, main: readonly LatticeCell[], through: boolean, stream: SeededStream): SewerNode[] => {
  const mainKeys = new Set<string>();
  main.forEach(([i, j], k) => {
    const n = graph.nodeAt(i, j);
    if (mainKeys.has(n.key)) return;
    mainKeys.add(n.key);
    if (k % 2 === 0 || (through && k === main.length - 1)) {
      n.manhole = true;
      n.manholeCorner = [stream.signedUnit(), stream.signedUnit()];
    } else if (stream.next() < ROOM_CHANCE) n.room = true;
  });
  return Array.from(mainKeys, (k) => graph.nodes.get(k)!);
};

/** Blind branches of one or two streets from random main nodes, preferring to turn. */
const addBranches = (lattice: Lattice, graph: SewerGraph, mainNodes: readonly SewerNode[], stream: SeededStream, visited: Set<string>, used: Set<string>): void => {
  const branchCount = stream.intBetween(SEWER_BRANCH_MIN, SEWER_BRANCH_MAX);
  for (let b = 0; b < branchCount; b++) {
    const from = stream.pick(mainNodes);
    graph.linkPath(walk(lattice, [from.i, from.j], stream.intBetween(SEWER_BRANCH_LENGTH_MIN, SEWER_BRANCH_LENGTH_MAX), visited, used, stream, true));
  }
};

/** The side room behind a door: its center and the door's outward direction, in the world. */
export const sideRoomOf = (d: CityDistrict, node: SewerNode, side: number): { cx: number; cz: number; outX: number; outZ: number; cos: number; sin: number } => {
  const { ex, ez } = districtAxes(d);
  const dir = SEWER_DIRS[side];
  const outX = ex.x * dir[0] + ez.x * dir[1];
  const outZ = ex.z * dir[0] + ez.z * dir[1];
  const out = boxHalf(node) + REVEAL_DEPTH + SIDE_ROOM_HALF;
  return { cx: node.x + outX * out, cz: node.z + outZ * out, outX, outZ, cos: d.cos, sin: d.sin };
};

/** The street point of a node's manhole shaft: SHAFT_CORNER_IN inside the box's corner. */
export const manholeCenter = (d: CityDistrict, node: SewerNode): PointXZ => {
  const { ex, ez } = districtAxes(d);
  const [sx, sz] = node.manholeCorner;
  const off = boxHalf(node) - SHAFT_CORNER_IN;
  return { x: node.x + (ex.x * sx + ez.x * sz) * off, z: node.z + (ex.z * sx + ez.z * sz) * off };
};

/** A pipe's geometry between two nodes: its endpoints and walkways (the rest of a PipePiece is its
 *  system and bounds). */
const pipeBetween = (a: SewerNode, b: SewerNode): Omit<PipePiece, "kind" | "system" | "path" | "bounds"> => ({
  ax: a.x,
  az: a.z,
  bx: b.x,
  bz: b.z,
  floorA: a.floor,
  floorB: b.floor,
  flatA: boxHalf(a),
  flatB: boxHalf(b),
});

/** A street's frame for whatever runs along its pipe: the walkways, the length, the unit direction
 *  a → b and the left-hand side. */
export interface StreetFrame {
  pipe: PipeWalkway;
  length: number;
  dx: number;
  dz: number;
  sideX: number;
  sideZ: number;
}

export const streetFrameOf = (a: SewerNode, b: SewerNode): StreetFrame => {
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  const dx = (b.x - a.x) / length;
  const dz = (b.z - a.z) / length;
  return { pipe: pipeBetween(a, b), length, dx, dz, sideX: -dz, sideZ: dx };
};

/** The pieces of a layout (raw or merged) as one field system `systemKey`, path 0. */
export const layoutPieces = (layout: SewerLayout, systemKey: string): TunnelPiece[] => {
  const d = layout.district;
  const pieces: TunnelPiece[] = [];
  const box = (cx: number, cz: number, floor: number, height: number, halfX: number, halfZ: number): BoxPiece =>
    withBounds({ kind: "box" as const, system: systemKey, path: 0, cx, cz, floor, height, halfX, halfZ, cos: d.cos, sin: d.sin });
  for (const node of layout.nodes.values()) {
    pieces.push(box(node.x, node.z, node.floor, boxHeight(node), boxHalf(node), boxHalf(node)));
    if (node.room) pieces.push(box(node.x, node.z, node.floor - POOL_DEPTH, POOL_DEPTH, poolHalf, poolHalf));
    if (node.manhole) {
      const { x, z } = manholeCenter(d, node);
      const street = node.manholeInfo ? node.manholeInfo.streetY : computeVertexData(x, z).height;
      const shaft: ShaftPiece = withBounds({ kind: "shaft" as const, system: systemKey, path: 0, id: `manhole|${node.key}`, x, z, radius: SHAFT_RADIUS, bottom: node.floor + boxHeight(node) - SHAFT_CEILING_OVERLAP, street });
      pieces.push(shaft);
    }
    if (node.door >= 0) {
      const sr = sideRoomOf(d, node, node.door);
      const revealOut = boxHalf(node) + REVEAL_DEPTH / 2;
      // The reveal and the side room are squares turned with the district; a reveal is DOOR_WIDTH
      // across and REVEAL_DEPTH deep along the door's outward axis.
      const alongX = node.door % 2 === 0;
      pieces.push(box(node.x + sr.outX * revealOut, node.z + sr.outZ * revealOut, node.floor, DOOR_HEIGHT, alongX ? REVEAL_DEPTH / 2 : DOOR_WIDTH / 2, alongX ? DOOR_WIDTH / 2 : REVEAL_DEPTH / 2));
      pieces.push(box(sr.cx, sr.cz, node.floor, SIDE_ROOM_HEIGHT, SIDE_ROOM_HALF, SIDE_ROOM_HALF));
    }
  }
  for (const s of layout.streets) {
    const pipe: PipePiece = withBounds({ kind: "pipe" as const, system: systemKey, path: 0, ...pipeBetween(layout.nodes.get(s.a)!, layout.nodes.get(s.b)!) });
    pieces.push(pipe);
  }
  return pieces;
};

/** Whether a side room (its floor plan sampled at foot, waist and head height) keeps SIDE_ROOM_CLEAR
 *  from every other piece of air. */
const sideRoomClear = (d: CityDistrict, node: SewerNode, side: number, others: readonly TunnelPiece[]): boolean => {
  const field = compileField(others);
  const sr = sideRoomOf(d, node, side);
  const { ex, ez } = districtAxes(d);
  const steps = Math.floor((2 * SIDE_ROOM_HALF) / SIDE_ROOM_SAMPLE);
  for (let a = 0; a <= steps; a++) {
    for (let b = 0; b <= steps; b++) {
      const lx = -SIDE_ROOM_HALF + a * SIDE_ROOM_SAMPLE;
      const lz = -SIDE_ROOM_HALF + b * SIDE_ROOM_SAMPLE;
      const x = sr.cx + ex.x * lx + ez.x * lz;
      const z = sr.cz + ex.z * lx + ez.z * lz;
      for (const h of SIDE_ROOM_HEIGHTS) if (field(x, node.floor + h, z) < SIDE_ROOM_CLEAR) return false;
    }
  }
  return true;
};

/** Doors on junctions, one random free wall each, kept only where the side room clears the rest. */
const placeDoors = (layout: SewerLayout, stream: SeededStream): void => {
  for (const node of layout.nodes.values()) {
    if (node.room || stream.next() >= DOOR_CHANCE) continue;
    const free: number[] = [];
    for (let side = 0; side < 4; side++) if (!node.links[side]) free.push(side);
    if (free.length === 0) continue;
    const side = stream.pick(free);
    const others = layoutPieces(layout, layout.key);
    if (sideRoomClear(layout.district, node, side, others)) node.door = side;
  }
};

export const layoutMasks = (layout: SewerLayout): SkirtMask[] => {
  const masks: SkirtMask[] = [];
  for (const n of layout.nodes.values()) {
    const h = boxHalf(n) * Math.SQRT2;
    masks.push({ ax: n.x, ay: n.floor - (n.room ? POOL_DEPTH : CHANNEL_DEPTH), az: n.z, bx: n.x, by: n.floor + boxHeight(n), bz: n.z, radius: h });
  }
  for (const s of layout.streets) {
    const a = layout.nodes.get(s.a)!;
    const b = layout.nodes.get(s.b)!;
    masks.push({ ax: a.x, ay: a.floor + PIPE_AXIS_LIFT, az: a.z, bx: b.x, by: b.floor + PIPE_AXIS_LIFT, bz: b.z, radius: PIPE_RADIUS + 1 });
  }
  return masks;
};

/** One sewer system for a city cell, or null when no street can be walked from near its site. The
 *  layout draws from one seeded stream in a fixed order: the main path, the node kinds, the
 *  branches, then the doors. */
export const generateSewer = (key: string, biomeId: number, ix: number, iz: number, site: PointXZ): SewerSystem | null => {
  const stream = seededStream(`${domainConfig!.seed}|${key}|layout`);
  const d = getCityDistrict(site.x, site.z);
  const origin = latticeOrigin(d, site);
  const lattice = latticeOf(d, origin[0], origin[1], biomeId);
  const start = findStart(lattice, origin);
  if (!start) return null;

  const visited = new Set<string>();
  const used = new Set<string>();
  const { main, through } = walkMainPath(lattice, start, stream, visited, used);
  if (main.length < 2) return null;

  const graph = sewerGraph(d);
  graph.linkPath(main);
  const mainNodes = assignNodeKinds(graph, main, through, stream);
  addBranches(lattice, graph, mainNodes, stream, visited, used);

  const layout: SewerLayout = { key, district: d, nodes: graph.nodes, streets: graph.streets };
  placeDoors(layout, stream);

  const pieces = layoutPieces(layout, key);
  const bounds = emptyBounds();
  for (const p of pieces) growBounds(bounds, p.bounds);
  return { key, style: "sewer", biomeId, ix, iz, pieces, mouths: [], entrances: [], masks: layoutMasks(layout), bounds, district: d.key, layout };
};

// ── The manholes' rests (after generation) ────────────────────────────────

interface RestPoint {
  x: number;
  z: number;
  y: number;
}

/** The least-squares plane y = a·x + b·z + c through the points (Cramer's rule on the 3×3 normal
 *  equations); flat at the mean height when the points are degenerate. */
const fitPlane = (pts: readonly RestPoint[]): { a: number; b: number; c: number } => {
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sxy = 0, szy = 0, sy = 0;
  for (const p of pts) {
    sxx += p.x * p.x;
    sxz += p.x * p.z;
    szz += p.z * p.z;
    sx += p.x;
    sz += p.z;
    sxy += p.x * p.y;
    szy += p.z * p.y;
    sy += p.y;
  }
  const N = pts.length;
  const det = sxx * (szz * N - sz * sz) - sxz * (sxz * N - sz * sx) + sx * (sxz * sz - szz * sx);
  let a = 0;
  let b = 0;
  let c = sy / N;
  if (Math.abs(det) > 1e-12) {
    a = (sxy * (szz * N - sz * sz) - sxz * (szy * N - sz * sy) + sx * (szy * sz - szz * sy)) / det;
    b = (sxx * (szy * N - sz * sy) - sxy * (sxz * N - sz * sx) + sx * (sxz * sy - szy * sx)) / det;
    c = (sxx * (szz * sy - sz * szy) - sxz * (sxz * sy - sz * sxy) + sxy * (sxz * sz - szz * sx)) / det;
  }
  return { a, b, c };
};

/** A rigid disc of radius COVER_RADIUS resting over `groundAt`: tilted to the best-fit plane of a
 *  COVER_FIT_POINTS² grid under it, raised until no sampled point (nor any of `extra`) is closer than
 *  COVER_CLEARANCE. */
const restDisc = (cx: number, cz: number, groundAt: (x: number, z: number) => number, extra: readonly RestPoint[]): DiscPose => {
  const pts: RestPoint[] = [];
  const n = COVER_FIT_POINTS;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      const dx = (-1 + (2 * a) / (n - 1)) * COVER_RADIUS;
      const dz = (-1 + (2 * b) / (n - 1)) * COVER_RADIUS;
      if (dx * dx + dz * dz > COVER_RADIUS * COVER_RADIUS + 1e-9) continue;
      pts.push({ x: dx, z: dz, y: groundAt(cx + dx, cz + dz) });
    }
  }
  const plane = fitPlane(pts);
  const a = plane.a;
  const b = plane.b;
  let c = plane.c;
  for (const p of pts.concat(extra.map((e) => ({ x: e.x - cx, z: e.z - cz, y: e.y })))) {
    const plane = a * p.x + b * p.z + c;
    if (plane - p.y < COVER_CLEARANCE) c += COVER_CLEARANCE - (plane - p.y);
  }
  const len = Math.hypot(a, 1, b);
  return { x: cx, y: c, z: cz, nx: -a / len, ny: 1 / len, nz: -b / len };
};

const manholeInfoOf = (d: CityDistrict, node: SewerNode): ManholeInfo => {
  const c = manholeCenter(d, node);
  const { ex, ez } = districtAxes(d);
  const [sx, sz] = node.manholeCorner;
  // The exit along the street: the axis of a linked street, pointing away from the box's middle.
  let faceX: number;
  let faceZ: number;
  if (node.links[0] || node.links[2]) {
    faceX = ex.x * sx;
    faceZ = ex.z * sx;
  } else {
    faceX = ez.x * sz;
    faceZ = ez.z * sz;
  }
  const streetY = computeVertexData(c.x, c.z).height;
  const frameGround = new Float32Array(FRAME_SAMPLES * 2);
  const frameTop: RestPoint[] = [];
  for (let k = 0; k < FRAME_SAMPLES; k++) {
    const ang = (k * 2 * Math.PI) / FRAME_SAMPLES;
    for (let r = 0; r < 2; r++) {
      const radius = r === 0 ? FRAME_INNER_RADIUS : FRAME_OUTER_RADIUS;
      const x = c.x + Math.cos(ang) * radius;
      const z = c.z + Math.sin(ang) * radius;
      const g = restingGroundAt(x, z);
      frameGround[k * 2 + r] = g;
      if (radius <= COVER_RADIUS) frameTop.push({ x, z, y: g + FRAME_TOP_OVER_GROUND });
    }
  }
  const exitX = c.x + faceX * MANHOLE_EXIT_OUT;
  const exitZ = c.z + faceZ * MANHOLE_EXIT_OUT;
  const asideX = c.x - faceX * MANHOLE_ASIDE_OUT;
  const asideZ = c.z - faceZ * MANHOLE_ASIDE_OUT;
  return {
    floorY: node.floor,
    ceilingY: node.floor + boxHeight(node),
    streetY,
    exitX,
    exitY: restingGroundAt(exitX, exitZ),
    exitZ,
    faceX,
    faceZ,
    frameGround,
    closed: restDisc(c.x, c.z, (x, z) => restingGroundAt(x, z) + FRAME_TOP_OVER_GROUND, frameTop),
    aside: restDisc(asideX, asideZ, restingGroundAt, []),
  };
};

/** After generation (the ground read here is bulged and the drawn-ground lattice may fill): the
 *  manholes' rests and the entrances. */
export const finishSewer = (system: SewerSystem): void => {
  const layout = system.layout;
  const entrances: TunnelEntrance[] = [];
  for (const node of layout.nodes.values()) {
    if (!node.manhole) continue;
    node.manholeInfo = manholeInfoOf(layout.district, node);
    const c = manholeCenter(layout.district, node);
    entrances.push({ kind: "manhole", id: `manhole|${node.key}`, x: c.x, y: node.manholeInfo.streetY, z: c.z, dirX: node.manholeInfo.faceX, dirZ: node.manholeInfo.faceZ, radius: SHAFT_RADIUS, manhole: node.manholeInfo });
  }
  system.entrances = entrances;
};

// ── Merging per district ──────────────────────────────────────────────────

const mergedLayouts = new Map<string, SewerLayout>();
const MERGED_CACHE_MAX = 64;

export const clearSewerLayouts = (): void => mergedLayouts.clear();

/** ONE layout for the systems of a district (in key order): nodes by key (links OR'd, a manhole kept,
 *  room wins, the first door kept unless the merge put a pipe or a room behind it), pipes by endpoints. */
export const mergeLayouts = (district: string, systems: readonly TunnelSystem[]): SewerLayout => {
  const cached = mergedLayouts.get(district);
  if (cached) return cached;
  if (mergedLayouts.size >= MERGED_CACHE_MAX) dropOldestHalf(mergedLayouts);
  const ordered = systems.slice().sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const nodes = new Map<string, SewerNode>();
  const streets: SewerStreet[] = [];
  const seen = new Set<string>();
  let d: CityDistrict | null = null;
  for (const s of ordered) {
    if (!isSewerSystem(s)) continue;
    const layout = s.layout;
    d = layout.district;
    for (const n of layout.nodes.values()) {
      const m = nodes.get(n.key);
      if (!m) {
        nodes.set(n.key, { ...n, links: [...n.links] as SewerNode["links"] });
        continue;
      }
      for (let k = 0; k < 4; k++) m.links[k] = m.links[k] || n.links[k];
      if (n.manhole && !m.manhole) {
        m.manhole = true;
        m.manholeCorner = n.manholeCorner;
        m.manholeInfo = n.manholeInfo;
      }
      if (n.room) m.room = true;
      if (m.door < 0 && n.door >= 0) m.door = n.door;
    }
    for (const st of layout.streets) {
      const k = streetKey(st.a, st.b);
      if (seen.has(k)) continue;
      seen.add(k);
      streets.push(st);
    }
  }
  for (const n of nodes.values()) if (n.door >= 0 && (n.links[n.door] || n.room)) n.door = -1;
  const merged: SewerLayout = { key: district, district: d!, nodes, streets };
  mergedLayouts.set(district, merged);
  return merged;
};

/** The doors of a layout: the hinge frame at the reveal's far face, +z into the side room. */
export const layoutDoors = (layout: SewerLayout): SewerDoor[] => {
  const out: SewerDoor[] = [];
  for (const n of layout.nodes.values()) {
    if (n.door < 0) continue;
    const sr = sideRoomOf(layout.district, n, n.door);
    const far = boxHalf(n) + REVEAL_DEPTH;
    out.push({ id: `door|${n.key}|${n.door}`, x: n.x + sr.outX * far, y: n.floor, z: n.z + sr.outZ * far, yaw: Math.atan2(sr.outX, sr.outZ), width: DOOR_WIDTH, height: DOOR_HEIGHT });
  }
  return out;
};
