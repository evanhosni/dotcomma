/**
 * The PONDS a river holds (water/DECISIONS.md "Ponds on rivers", "Every river end rolls"): discs of the
 * river field, decided on the river's own layers, each a pure function of its edge (and its junctions').
 * water/ponds/ rolls their kinds and places the standalone ones; summits.ts the ponds a climb reaches.
 *   - An END: every end of a built stretch that is not a mouth, a road's or a junction where the river
 *     goes on — at a junction or at unbuilt land alike — rolls ONCE among the <Pond riverEnd> mounts of
 *     the biome under its end joint (riverEndPondOf). A hit is a pond of that kind; a miss ends the river
 *     ROUND, at its own width (network.ts). The pond stands on the end joint (half its radius further out,
 *     the design's, it dug up to 70u into a mountain's foot) — but never in a lake or within a road's
 *     reach: the road layer and the decks read the river's pieces alone, so there the end keeps the
 *     widening (network.ts) they can see.
 *   - MID-RIVER: a slot every POND_MID_RIVER_SPACING (jittered), rolled first, kept on a calm stretch —
 *     plain built pieces two footprints each way (no gorge, climb or stretch end), grade ≤ its
 *     <Pond calmGrade>, no road cap, no lake approach, no confluence or road within reach — centred on
 *     a joint.
 * A mid-river pond's level is the lowest water of the river's joints within its radius, and those joints
 * are held at it (edgeSurfaces), so the river meets the pond's still water level where they join; an
 * end's is its end joint's water, the river running into it at its own grade.
 *
 * Like every pipeline module it imports the others in a cycle (vertexCompute.ts): no export of theirs is
 * used at this module's top level.
 */

import { seedRand } from "../../../math";
import { domainConfig } from "../../computeConfig";
import { zoneAtWarped } from "../../voronoi";
import { shoreReach } from "../lakes";
import { isLakeBiome } from "../lakes/params";
import { pondDisc, pondFootprint, pondKindAt, pondMinRadiusAt, pondModeMax, pondRadius, pondWidth } from "../ponds";
import type { PondMount } from "../ponds/params";
import { type RoadPath, pondTouchesRoad } from "../utils";
import type { FieldDisc } from "../types";
import { PIECE_BUILT, POND_MID_RIVER_SPACING } from "./constants";
import { type StretchEnd, finalEdge, riverContinuesAt, riverPiecesIn, stretchesOf } from "./network";
import { climbedCodes, summitPondsOn } from "./summits";
import { type EdgeSurfaces, edgeSurfaces } from "./surface";
import type { RiverEdge, RiverJunction, RiverPond } from "./types";

/** A pond's footprint radius (real) at waterline radius `r`. */
const footprintOf = (r: number, mount: PondMount): number => pondFootprint(pondWidth(r, mount.kind.blob.amount), mount.kind.blob.amount);

/** The seed key of the end of edge e at a joint: its roll and its pond's shape hang from it. */
const endKeyOf = (e: RiverEdge, joint: number): string => `${domainConfig!.seed} - water end ${e.key}:${joint}`;

/** The <Pond riverEnd> kind a natural river end at a joint of edge e rolls (null: none — the river ends
 *  round): its end joint's biome's mounts, cumulative in JSX order (pondKindAt). */
export const riverEndPondOf = (e: RiverEdge, joint: number): PondMount | null => {
  if (pondModeMax("riverEnd") <= 0) return null;
  const L = e.len / e.count;
  return pondKindAt(zoneAtWarped(e.ax + e.ux * L * joint, e.az + e.uz * L * joint).biome.id, "riverEnd", seedRand(endKeyOf(e, joint)));
};

/** The width factor along edge e before any end shape. */
const linearWidth = (e: RiverEdge, k: number): number => e.a.width + ((e.b.width - e.a.width) * k) / e.count;

/** The discs at the pond ends of an edge's built stretches, where one may stand: not in a lake zone, nor
 *  within reach of `roads` (the paths its road layer read; null: the network's pure distance queries — the
 *  far field's raw ends, which must not depend on whether this edge's road layer has run). */
export const endPondsOf = (e: RiverEdge, ends: StretchEnd[], roads: readonly RoadPath[] | null): RiverPond[] => {
  const out: RiverPond[] = [];
  const hw = domainConfig!.river.halfWidth;
  const L = e.len / e.count;
  for (const { kind, pond: mount, joint } of ends) {
    if (kind !== "pond" || !mount) continue;
    const key = endKeyOf(e, joint);
    const jx = e.ax + e.ux * L * joint;
    const jz = e.az + e.uz * L * joint;
    const r = Math.max(pondRadius(mount, key), mount.minRadiusOverRiver * linearWidth(e, joint) * hw, pondMinRadiusAt(jx, jz));
    if (isLakeBiome(zoneAtWarped(jx, jz).biome) || pondTouchesRoad(jx, jz, footprintOf(r, mount), roads)) continue;
    out.push({ x: jx, z: jz, r, mount, key, joint });
  }
  return out;
};

/** The MID-RIVER ponds on an edge's calm stretches, judged on its surfaces before any pond holds them. */
const midRiverPondsOf = (e: RiverEdge, s: EdgeSurfaces, caps: Float64Array): RiverPond[] => {
  const out: RiverPond[] = [];
  const max = pondModeMax("midRiver");
  if (max <= 0) return out;
  const pieces = finalEdge(e);
  const codes = climbedCodes(e);
  const hw = domainConfig!.river.halfWidth;
  const L = e.len / e.count;
  for (let m = 0; (m + 1) * POND_MID_RIVER_SPACING <= e.len; m++) {
    // The seed string keeps the mode's old name: renaming it would move every mid-river pond.
    const key = `${domainConfig!.seed} - water along ${e.key}:${m}`;
    const u = seedRand(key);
    if (u >= max) continue;
    const k = Math.round(((m + 0.2 + 0.6 * seedRand(`${key} at`)) * POND_MID_RIVER_SPACING) / L);
    const x = e.ax + e.ux * L * k;
    const z = e.az + e.uz * L * k;
    const mount = pondKindAt(zoneAtWarped(x, z).biome.id, "midRiver", u);
    if (!mount) continue;
    const r = Math.max(pondRadius(mount, key), mount.minRadiusOverRiver * e.widths![k] * hw, pondMinRadiusAt(x, z));
    const footprint = footprintOf(r, mount);
    const calm = Math.ceil((2 * footprint) / L);
    if (k - calm < 0 || k + calm > e.count) continue;
    let ok = true;
    for (let i = k - calm; i < k + calm && ok; i++) ok = !!pieces[i] && codes[i] === PIECE_BUILT;
    // No road's cap holds its water down, and no lake's approach (the shore is Infinity with none in reach).
    for (let i = k - calm; i <= k + calm && ok; i++) ok = caps[i] >= s.uncapped[i] && !(s.shore[i] <= shoreReach());
    if (!ok) continue;
    const n = Math.max(1, Math.ceil(r / L));
    if (Math.abs(s.uncapped[Math.min(e.count, k + n)] - s.uncapped[Math.max(0, k - n)]) > mount.calmGrade * 2 * n * L) continue;
    const confluence = (j: typeof e.a) => riverContinuesAt(e, j) && Math.hypot(j.x - x, j.z - z) < 2 * footprint;
    if (confluence(e.a) || confluence(e.b)) continue;
    if (pondTouchesRoad(x, z, footprint, e.roads ?? [])) continue;
    out.push({ x, z, r, mount, key, joint: k });
  }
  return out;
};

/** A pond an edge holds (an end's or a mid-river one), and the joints within its radius, which its level holds. */
interface HeldPond {
  pond: RiverPond;
  joints: number[];
}

/** The ponds edge e holds at its ends and mid-river, judged on its surfaces before any pond holds them, and
 *  the joints each holds at its level: a mid-river pond's within its radius, an end's its end joint. */
export const heldRiverPonds = (e: RiverEdge, s: EdgeSurfaces, caps: Float64Array): HeldPond[] => {
  const L = e.len / e.count;
  const midRiver = midRiverPondsOf(e, s, caps).map((pond) => {
    const joints: number[] = [];
    for (let k = 0; k <= e.count; k++) if (Math.hypot(e.ax + e.ux * L * k - pond.x, e.az + e.uz * L * k - pond.z) <= pond.r || k === pond.joint) joints.push(k);
    return { pond, joints };
  });
  // An end's pond takes its end joint's water as it is: held over its radius, the stretch stepped down
  // into it and its last piece drew as a fall (whitewater in a desert pond at (−917, −1804)).
  return [...(e.ponds ?? []).map((pond) => ({ pond, joints: [pond.joint] })), ...midRiver];
};

/** Holds the water at each pond: its joints take the lowest water among them, its level (only ever
 *  lowering, so it settles with the caps' grade and the gorges' lines). */
export const holdPonds = (held: HeldPond[], capped: Float64Array): void => {
  for (const { joints } of held) {
    const level = Math.min(...joints.map((k) => capped[k]));
    for (const k of joints) capped[k] = level;
  }
};

/** The discs of every pond an edge holds, at their levels — and its summits' ponds. */
export const riverPondDiscsOf = (e: RiverEdge, held: HeldPond[], capped: Float64Array): FieldDisc[] => [
  ...summitPondsOn(e).map(({ pond: p }) => pondDisc(p.mount, p.x, p.z, p.r, p.level, `${p.key} phase`)),
  ...held.map(({ pond: p }) => pondDisc(p.mount, p.x, p.z, p.r, capped[p.joint], `${p.key} phase`)),
];

/** The discs the FAR field reads of edge e (field.ts farRiverFieldAt), without its road layer: its summits'
 *  ponds, and the end ponds of its stretches before any road (`goesOn`: whether another raw river leaves a
 *  junction), each at its end joint's water before any road (`water`), kept off the roads by the network's
 *  pure distance queries (this edge's own road layer may not have run). */
export const rawPondDiscsOf = (e: RiverEdge, goesOn: (j: RiverJunction) => boolean, water: Float64Array): FieldDisc[] => [
  ...summitPondsOn(e).map(({ pond: p }) => pondDisc(p.mount, p.x, p.z, p.r, p.level, `${p.key} phase`)),
  ...endPondsOf(e, stretchesOf(e, climbedCodes(e), (j) => (goesOn(j) ? "none" : "natural")).flat(), null).map((p) =>
    pondDisc(p.mount, p.x, p.z, p.r, water[p.joint], `${p.key} phase`),
  ),
];

/** Every river pond's disc whose centre lies in the warped box. */
export const riverPondDiscsIn = (x0: number, z0: number, x1: number, z1: number): FieldDisc[] => {
  const out: FieldDisc[] = [];
  // A pond's centre is a joint of a built piece of its river.
  const pad = 1;
  const edges = new Set<RiverEdge>();
  for (const p of riverPiecesIn(x0, z0, x1, z1, pad)) edges.add(p.edge);
  for (const e of edges) for (const d of edgeSurfaces(e).ponds) if (d.x >= x0 && d.x < x1 && d.z >= z0 && d.z < z1) out.push(d);
  return out;
};
