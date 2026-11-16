/**
 * RIVERS as the rest of water/ sees them: the narrow interface the composition (../index.ts), ponds/ and
 * parts/ read the rivers through. The river modules import one another directly, and so do the pipeline's
 * other systems (vertexCompute, roads/, bridges/, underground/, the content components), which share the
 * pipeline's import cycle with them. Three-free.
 *
 * Every export is this module's own and reads the modules behind it only when called: they are in the
 * pipeline's import cycle, and a RE-export is read when this module loads — webpack's React Refresh
 * registration read one before its module had run, and the page never started.
 */

import { distanceToSegment } from "../../../math";
import { ZONE_WEIGHT_EPS, zoneFinal, zones } from "../../zoneBlend";
import type { FieldDisc, WallShape } from "../types";
import { capRiverBed as capBed } from "./bedLimit";
import { DISC_WIDTH_MAX, riverKeepOff, riverMaxReach as maxReach } from "./constants";
import { finalEdge as edgePieces, riverPiecesNear as piecesNear, riversEnabled } from "./network";
import { riverSample } from "./field";
import { type RiverShape, riverBodyOf as bodyOf, riversIn } from "./params";
import { riverPondDiscsIn as pondDiscsIn } from "./ponds";
import { edgeSurfaces as surfacesOf, type EdgeSurfaces } from "./surface";
import type { RiverEdge, RiverPiece } from "./types";

export type { RiverEdge, RiverPiece } from "./types";
export { DISC_WIDTH_MAX, riverKeepOff } from "./constants";

/** Whether the domain has any river at all. */
export const riversExist = (): boolean => riversEnabled;
/** The farthest a footprint reaches from its centerline (real units). */
export const riverMaxReach = (): number => maxReach();
/** The built pieces within `pad` of a warped box. */
export const riverPiecesNear = (minX: number, minZ: number, maxX: number, maxZ: number, pad: number): RiverPiece[] => piecesNear(minX, minZ, maxX, maxZ, pad);
/** Edge e's pieces as built (null: not built). */
export const finalEdge = (e: RiverEdge): (RiverPiece | null)[] => edgePieces(e);
/** Edge e's water at every joint. */
export const edgeSurfaces = (e: RiverEdge): EdgeSurfaces => surfacesOf(e);
/** Every river pond's disc whose centre lies in the warped box. */
export const riverPondDiscsIn = (x0: number, z0: number, x1: number, z1: number): FieldDisc[] => pondDiscsIn(x0, z0, x1, z1);

/** Whether any river's footprint comes within `reach` (real units) of a warped point. */
export const riverFootprintWithin = (x: number, z: number, reach: number): boolean => {
  for (const p of piecesNear(x, z, x, z, reach + riverKeepOff() * DISC_WIDTH_MAX)) {
    if (distanceToSegment(x, z, p.sx, p.sz, p.ex, p.ez) < reach + riverKeepOff() * Math.max(p.w0, p.w1)) return true;
  }
  return false;
};

/** The river field step 2 read for the vertex in progress (rivers/field.ts riverFieldAt). */
export type RiverFieldSample = Readonly<typeof riverSample>;
export const riverField = (): RiverFieldSample => riverSample;
/** The <Rivers> a river belongs to where it runs through a biome (−1: none mounted there). */
export const riverBodyOf = (biomeId: number): number => bodyOf(biomeId);
/** A bed paint distance capped at a bed limit (rivers/bedLimit.ts). */
export const capRiverBed = (distance: number, limit: number): number => capBed(distance, limit);

/** What a channel's carve reads of the rivers where it runs: its depth scale and its walls. */
type ChannelShape = Pick<RiverShape, "depth"> & WallShape;
const CHANNEL_KEYS: readonly (keyof ChannelShape)[] = ["depth", "wallGrade", "wallEase", "wallReach"];
const blended: ChannelShape = { depth: 1, wallGrade: 0, wallEase: 0, wallReach: 0 };
const sameChannel = (a: ChannelShape, b: ChannelShape): boolean =>
  a.depth === b.depth && a.wallGrade === b.wallGrade && a.wallEase === b.wallEase && a.wallReach === b.wallReach;
/** The rivers' channel shape at the vertex in progress: each weighing zone's (rivers/params.ts riversIn),
 *  blended by the zone weights — or, where every zone agrees, exactly theirs. Read-only, and valid only
 *  until the next call: where zones disagree it is this module's shared scratch. */
export const currentRiverShape = (): Readonly<ChannelShape> => {
  let first: ChannelShape | null = null;
  let uniform = true;
  for (let i = 0; i < zones.length; i++) {
    if (zoneFinal[i] < ZONE_WEIGHT_EPS) continue;
    const s = riversIn(zones[i]);
    if (!first) first = s;
    else if (uniform && s !== first) uniform = sameChannel(s, first);
  }
  if (!first) return riversIn(zones[0]);
  if (uniform) return first;
  let weight = 0;
  for (const k of CHANNEL_KEYS) blended[k] = 0;
  for (let i = 0; i < zones.length; i++) {
    if (zoneFinal[i] < ZONE_WEIGHT_EPS) continue;
    const s = riversIn(zones[i]);
    for (const k of CHANNEL_KEYS) blended[k] += zoneFinal[i] * s[k];
    weight += zoneFinal[i];
  }
  for (const k of CHANNEL_KEYS) blended[k] /= weight;
  return blended;
};
