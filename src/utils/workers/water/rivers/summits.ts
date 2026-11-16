/**
 * SUMMIT connections (water/DECISIONS.md "Ponds on rivers"; rivers/network.ts layer 1½). Where the gorge
 * layer left a gap of high ground between two waters — inside an edge, two edges' gaps meeting at a
 * junction no river leaves, or one gap into a junction where a river goes on — from its rules' `shortGap`
 * (anything shorter is carved, never climbed) to their `summitMaxGap` long (params.ts GapRules: the edge's,
 * the stricter of two at a junction), and the biome at its top rolls a <Pond summit> kind, the river CLIMBS
 * it: a pond stands on the gap's flattest joint within SUMMIT_SLIDE_DROP of its top (its level that joint's
 * water, or less, under the lowest ground round its radius), the gap's pieces are built as PIECE_CLIMB,
 * their water held at the pond's level within its radius and falling away from it to both waters (a
 * running minimum of the ground's water: never rising away from the pond), the stream narrowing toward the
 * pond to its <Pond summitStream>.
 *
 * A gap whose fall from the pond would cut a second ridge deeper than a gorge may (`maxCarve`) is left as
 * it was. Every decision is a pure function of an
 * edge or a junction, read off its edges' GORGED codes, so any query order agrees. With no <Pond summit>
 * mounted in the domain the layer is the gorged codes themselves (no roll, no cost).
 *
 * Like every pipeline module it imports the others in a cycle (vertexCompute.ts): no export of theirs is
 * used at this module's top level.
 */

import { seedRand, smoothstep } from "../../../math";
import { dropOldestHalf } from "../../cellCache";
import { domainConfig } from "../../computeConfig";
import { zoneAtWarped } from "../../voronoi";
import { WATER_BELOW_GROUND } from "../constants";
import { pondFootprint, pondKindAt, pondMinRadiusAt, pondModeMax, pondRadius, pondSite, pondWidth } from "../ponds";
import { roadPathsNear } from "../utils";
import { PIECE_CLIMB, SUMMIT_SLIDE_DROP, pieceBuilt } from "./constants";
import { jointAt, junctionEdges } from "./network";
import { builtAtJunction, gapFromJunction, gapPairs, gorgedCodes, isHigh, type JunctionGap, pairRule, runsOf } from "./pieceRules";
import { riverEdgeNearRoads } from "./roadLayer";
import { baseJointSurface } from "./surface";
import type { RiverEdge, RiverJunction, RiverPiece, Summit } from "./types";

/** A joint of an edge, on a gap's path. */
interface PathJoint {
  e: RiverEdge;
  k: number;
}
const jointX = (p: PathJoint): number => p.e.ax + (p.e.ux * p.e.len * p.k) / p.e.count;
const jointZ = (p: PathJoint): number => p.e.az + (p.e.uz * p.e.len * p.k) / p.e.count;

/** The pond on a gap's path (from one water's joint to the other's, or to the junction — at path index
 *  `through` when it climbs through one), or null: no kind rolled, or no joint near the top leaves the
 *  pond's footprint clear of both ends. */
const summitOf = (path: PathJoint[], key: string, junction: RiverJunction | null, through = -1): Summit | null => {
  const seed = `${domainConfig!.seed} - water summit ${key}`;
  const u = seedRand(seed);
  if (u >= pondModeMax("summit")) return null;
  // No road within the climb's reach: its cap would hold the water down under the pond (the road layer
  // comes after this one, so it asks the roads as the road layer does, of the climb's own pieces).
  if (path.some((p) => riverEdgeNearRoads(p.e))) {
    const pieces: RiverPiece[] = [];
    for (let i = 0; i + 1 < path.length; i++) {
      pieces.push({ sx: jointX(path[i]), sz: jointZ(path[i]), ex: jointX(path[i + 1]), ez: jointZ(path[i + 1]), w0: 1, w1: 1, edge: path[i].e, index: path[i].k });
    }
    if (roadPathsNear(path[0].e, pieces).length > 0) return null;
  }
  const water = path.map((p) => baseJointSurface(p.e, p.k));
  let top = 0;
  for (let i = 1; i < path.length; i++) if (water[i] > water[top]) top = i;
  const mount = pondKindAt(zoneAtWarped(jointX(path[top]), jointZ(path[top])).biome.id, "summit", u);
  if (!mount) return null;
  const r = Math.max(pondRadius(mount, seed), pondMinRadiusAt(jointX(path[top]), jointZ(path[top])));
  const amount = mount.kind.blob.amount;
  const clear = pondFootprint(pondWidth(r, amount), amount);
  const along = [0];
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + Math.hypot(jointX(path[i]) - jointX(path[i - 1]), jointZ(path[i]) - jointZ(path[i - 1])));
  const total = along[path.length - 1];
  // The flattest joint near the top (ponds/ pondSite, as a standalone pond's), the nearest the top of equals.
  let best = -1;
  let bestFlat = Infinity;
  let bestLow = Infinity;
  for (let i = 1; i < path.length - 1; i++) {
    if (water[i] < water[top] - SUMMIT_SLIDE_DROP || along[i] < clear || total - along[i] < clear) continue;
    const dx = jointX(path[i + 1]) - jointX(path[i - 1]);
    const dz = jointZ(path[i + 1]) - jointZ(path[i - 1]);
    const l = Math.hypot(dx, dz) || 1;
    const { spread, low } = pondSite(jointX(path[i]), jointZ(path[i]), r, dx / l, dz / l);
    if (spread < bestFlat || (spread === bestFlat && Math.abs(i - top) < Math.abs(best - top))) {
      best = i;
      bestFlat = spread;
      bestLow = low;
    }
  }
  if (best < 0) return null;
  const centre = path[best];
  // Its level under the LOWEST ground round its radius, as a standalone pond's: a pond grown to its biome's
  // pondMinRadius over a summit's shoulder held its rim up there as a dam (100u at (−12938, 17249)); under it,
  // the bank cuts a bowl — and a site too steep for one fails the fall check below and is not climbed.
  const pond = { x: jointX(centre), z: jointZ(centre), r, mount, key: seed, joint: centre.k, level: Math.min(water[best], bestLow - WATER_BELOW_GROUND) };
  // The climb's water along the path: the pond's level within its radius, falling away from it. A gap
  // with a second ridge the fall would have to cut deeper than a gorge may (each joint's edge's
  // `maxCarve`) is not climbed: the running minimum trenched 140u through the lower hump of a double massif.
  const fall = new Float64Array(path.length);
  fall[best] = pond.level;
  for (const step of [1, -1]) {
    for (let i = best + step, v = pond.level; i >= 0 && i < path.length; i += step) {
      fall[i] = v = held(pond, jointX(path[i]), jointZ(path[i])) ? pond.level : Math.min(water[i], v);
      if (water[i] - v > path[i].e.rules.maxCarve) return null;
    }
  }
  return { pond, edge: centre.e, junction, junctionWater: junction ? fall[through] : NaN };
};

/** Whether a point lies within a pond's radius: the river's water there is the pond's. */
const held = (pond: { x: number; z: number; r: number }, x: number, z: number): boolean => Math.hypot(x - pond.x, z - pond.z) <= pond.r;

const pathOf = (g: JunctionGap, toJunction: boolean): PathJoint[] => {
  const out: PathJoint[] = [];
  const dir = g.junction > g.stretch ? 1 : -1;
  for (let k = g.stretch; k !== g.junction + dir; k += dir) out.push({ e: g.e, k });
  return toJunction ? out : out.reverse();
};

/** What a junction decides: each climb into it, by edge key. Where a river goes on there, every gap into
 *  it on its own; where none does, the shortest pair of gaps as one path through it. */
interface JunctionClimb {
  gap: JunctionGap;
  summit: Summit;
}
const junctionDecisions = new Map<string, JunctionClimb[]>();
const junctionClimbs = (j: RiverJunction): JunctionClimb[] => {
  const cached = junctionDecisions.get(j.key);
  if (cached) return cached;
  const out: JunctionClimb[] = [];
  const gaps = junctionEdges(j)
    .map((e) => gapFromJunction(e, j, gorgedCodes(e), (r) => r.summitMaxGap))
    .filter((g): g is JunctionGap => g !== null);
  if (builtAtJunction(j, gorgedCodes)) {
    for (const g of gaps) {
      if (g.length < g.e.rules.shortGap) continue;
      const path = pathOf(g, true);
      const summit = summitOf(path, `${j.key}>${g.e.key}`, j, path.length - 1);
      if (summit) out.push({ gap: g, summit });
    }
  } else {
    let pair: [JunctionGap, JunctionGap] | null = null;
    for (const [g1, g2] of gapPairs(gaps)) {
      const length = g1.length + g2.length;
      if (length < pairRule(g1, g2, "shortGap") || length > pairRule(g1, g2, "summitMaxGap")) continue;
      if (!pair || length < pair[0].length + pair[1].length) pair = [g1, g2];
    }
    if (pair) {
      const into = pathOf(pair[0], true);
      const summit = summitOf([...into, ...pathOf(pair[1], false).slice(1)], j.key, j, into.length - 1);
      if (summit) out.push({ gap: pair[0], summit }, { gap: pair[1], summit });
    }
  }
  if (junctionDecisions.size > 16384) dropOldestHalf(junctionDecisions);
  junctionDecisions.set(j.key, out);
  return out;
};

/** The edge's codes with its summit climbs built (its gorged codes where none is), and its climbs. */
export const climbedCodes = (e: RiverEdge): Uint8Array => {
  if (e.climbed) return e.climbed;
  const gorged = gorgedCodes(e);
  e.climbs = [];
  if (pondModeMax("summit") <= 0) return (e.climbed = gorged);
  const codes = gorged.slice();
  const L = e.len / e.count;
  for (const [g0, g1] of runsOf(gorged, isHigh)) {
    const length = (g1 - g0 + 1) * L;
    if (g0 === 0 || g1 === e.count - 1 || length < e.rules.shortGap || length > e.rules.summitMaxGap) continue;
    if (!pieceBuilt(gorged[g0 - 1]) || !pieceBuilt(gorged[g1 + 1])) continue;
    const path: PathJoint[] = [];
    for (let k = g0; k <= g1 + 1; k++) path.push({ e, k });
    const summit = summitOf(path, `${e.key}:${g0}`, null);
    if (!summit) continue;
    codes.fill(PIECE_CLIMB, g0, g1 + 1);
    e.climbs.push({ k0: g0, k1: g1 + 1, summit });
  }
  for (const j of [e.a, e.b]) {
    for (const c of junctionClimbs(j)) {
      if (c.gap.e !== e) continue;
      const [k0, k1] = c.gap.stretch < c.gap.junction ? [c.gap.stretch, c.gap.junction] : [c.gap.junction, c.gap.stretch];
      codes.fill(PIECE_CLIMB, k0, k1);
      e.climbs.push({ k0, k1, summit: c.summit });
    }
  }
  e.climbed = codes;
  return codes;
};

/** The water every climb through junction j brings there (Infinity: none climbs through it): what the
 *  rivers sharing the junction's water are held at. */
export const climbJunctionWater = (j: RiverJunction): number => {
  if (pondModeMax("summit") <= 0) return Infinity;
  let v = Infinity;
  for (const c of junctionClimbs(j)) v = Math.min(v, c.summit.junctionWater);
  return v;
};

/** The water on an edge's climbs (both surfaces, in place): the pond's level within its radius, then a
 *  running minimum of each joint's own water away from the pond — from the pond's joint where it stands
 *  on this edge, else from the junction the climb reaches it through. Returns the climbs' inner joints. */
export const climbSurfaces = (e: RiverEdge, capped: Float64Array, uncapped: Float64Array): Set<number> => {
  climbedCodes(e);
  const inner = new Set<number>();
  for (const { k0, k1, summit } of e.climbs ?? []) {
    const { pond } = summit;
    const at = (k: number) => held(pond, e.ax + (e.ux * e.len * k) / e.count, e.az + (e.uz * e.len * k) / e.count);
    const set = (k: number, v: number) => {
      capped[k] = v;
      uncapped[k] = v;
    };
    const sweep = (from: number, v: number, to: number) => {
      const step = to > from ? 1 : -1;
      for (let k = from + step; k !== to + step; k += step) set(k, (v = at(k) ? pond.level : Math.min(uncapped[k], v)));
    };
    for (let k = k0 + 1; k < k1; k++) inner.add(k);
    if (summit.edge === e) {
      set(pond.joint, pond.level);
      sweep(pond.joint, pond.level, k0);
      sweep(pond.joint, pond.level, k1);
    } else {
      const kj = summit.junction && jointAt(e, summit.junction) === k0 ? k0 : k1;
      // Never over the junction's own water: a pond holding the junction stands over a junction whose water
      // hangs under its lowest bank, which the junction keeps (a 0.36u rise toward it on edge 1,2~2,2).
      const v = Math.min(at(kj) ? pond.level : summit.junctionWater, uncapped[kj]);
      set(kj, v);
      sweep(kj, v, kj === k0 ? k1 : k0);
    }
  }
  return inner;
};

/** The climbs' narrowing, × each joint's width: its pond's <Pond summitStream> at the pond's waterline,
 *  full where the climb leaves its water. */
export const climbTaper = (e: RiverEdge, widths: Float64Array): void => {
  climbedCodes(e);
  const L = e.len / e.count;
  for (const { k0, k1, summit } of e.climbs ?? []) {
    const { pond } = summit;
    const dist = (k: number) => Math.hypot(e.ax + e.ux * L * k - pond.x, e.az + e.uz * L * k - pond.z);
    // The climb's outer joints: where it meets its water (a junction it climbs through is not one).
    const outer = [k0, k1].filter((k) => !summit.junction || k !== jointAt(e, summit.junction));
    const along = (pond.x - e.ax) * e.ux + (pond.z - e.az) * e.uz;
    for (let k = k0; k <= k1; k++) {
      const side = outer.filter((o) => (o * L - along) * (k * L - along) >= 0);
      const o = (side.length > 0 ? side : outer).reduce((a, b) => (Math.abs(b - k) < Math.abs(a - k) ? b : a));
      const reach = dist(o);
      if (reach <= pond.r) continue;
      const stream = pond.mount.summitStream;
      widths[k] *= stream + (1 - stream) * smoothstep(pond.r, reach, dist(k));
    }
  }
};

/** Every summit pond whose joint lies on edge e (each pond once, on the edge it stands on). */
export const summitPondsOn = (e: RiverEdge): Summit[] => {
  climbedCodes(e);
  const out: Summit[] = [];
  for (const c of e.climbs ?? []) if (c.summit.edge === e && !out.includes(c.summit)) out.push(c.summit);
  return out;
};

export const clearSummits = (): void => junctionDecisions.clear();
