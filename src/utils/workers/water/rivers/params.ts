/** The <Rivers> body: its params, their defaults and its accessors. Three-free. */

import { domainConfig } from "../../computeConfig";
import type { Zone } from "../../types";
import { bodyOf, RIVERS, waterBodyDefaults } from "../params";
import { WALL_DEFAULTS } from "../channel/params";
import type { WallShape, WaterColors } from "../types";

export { RIVERS } from "../params";

/** The <Rivers> body as mounted: only the props it names. Mounted in a region it is every biome's there;
 *  mounted in a biome it overrides its region's prop by prop (a biome may mount one for its parts alone). */
export interface RiversParams extends Partial<RiverShape>, Partial<WaterColors> {
  /** The chance (0–1) each river-grid edge whose midpoint lies here carries a river; 0 = dry. */
  chance?: number;
}

/** What a river is where it runs: biome → region → <Water defaults={{ rivers }}> → RIVERS_DEFAULTS. */
export interface RiverShape extends WallShape, GapRules {
  /** × a river's width factor at a junction here (capped like every factor). */
  width: number;
  /** × the channel's depth here (blended across biomes by their zone weights). */
  depth: number;
}

/** Where a river may run and which gaps it crosses (pieceRules.ts, summits.ts, network.ts): an edge is
 *  judged by the rules of the biome under its midpoint, the one its chance is rolled in; a gap at a junction
 *  between two edges by the stricter of theirs. Grades are rise per unit, lengths and heights real units,
 *  all on the network's approximate terrain except `maxCarve` (the real ground). */
export interface GapRules {
  /** A piece is HIGH ground over this grade along the river… */
  maxGrade: number;
  /** …on a ridge (its centerline this far above both footprint edges)… */
  maxRidge: number;
  /** …or on a hillside (this grade across its footprint). */
  maxCrossGrade: number;
  /** A built stretch shorter than this between two unbuilt ones is a pond blob and is not built. */
  minStretch: number;
  /** A gap of high ground up to this long with water on both sides is filled, or cut as a gorge. */
  gapFill: number;
  /** A gorge is cut where the real ground rises less than this over the water line between its two
   *  waters (past it the river ends at the foot)… */
  maxCarve: number;
  /** …or whatever the rise, across a gap no longer than this: two waters that close read as one river a
   *  ridge interrupts. Anything shorter is carved, never climbed to a summit. */
  shortGap: number;
  /** A gap the gorges left, up to this long, may be climbed to a summit pond (a <Pond summit>). */
  summitMaxGap: number;
}

export const RIVERS_DEFAULTS: RiverShape = {
  width: 1,
  depth: 1,
  ...WALL_DEFAULTS,
  maxGrade: 0.2,
  maxRidge: 6,
  maxCrossGrade: 0.15,
  minStretch: 300,
  gapFill: 800,
  maxCarve: 80,
  shortGap: 500,
  summitMaxGap: 3000,
};

/** A biome's own river chance, or undefined where it mounts no <Rivers> or one without a chance (its
 *  region's applies). */
export const biomeRiverChance = (biome: { features?: Readonly<Record<string, unknown>> }): number | undefined =>
  (biome.features?.[RIVERS] as RiversParams | undefined)?.chance;

/** The <Rivers> a river belongs to where it runs through a biome (−1: neither the biome nor its region
 *  mounts one — a river from elsewhere crossing it). */
export const riverBodyOf = (biomeId: number): number => bodyOf(biomeId, RIVERS);

const resolved = new Map<Zone, RiverShape>();
/** The rivers' shape in a zone: its biome's own <Rivers> props over its region's, over the <Water> base's
 *  defaults for every <Rivers>, over RIVERS_DEFAULTS. */
export const riversIn = (zone: Zone): RiverShape => {
  let shape = resolved.get(zone);
  if (!shape) {
    const region = domainConfig?.waterBodies.find((b) => b.kind === RIVERS && b.regionId === zone.region.id)?.params as RiversParams | undefined;
    const own = zone.biome.features?.[RIVERS] as RiversParams | undefined;
    shape = { ...RIVERS_DEFAULTS, ...waterBodyDefaults(RIVERS), ...region, ...own };
    resolved.set(zone, shape);
  }
  return shape;
};

export const clearRiverShapes = (): void => resolved.clear();
