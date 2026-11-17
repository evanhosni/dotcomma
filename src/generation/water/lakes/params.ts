/** The <Lake> body: its params, their defaults and its biome accessors. Three-free. */

import { biomeIdsWith } from "../../registry";
import { bodyOf, LAKE } from "../params";
import type { WaterColors } from "../types";

export { LAKE } from "../params";

/** A <Lake depth> as its body carries it: the biome it is mounted in IS water, its terrain a bowl under a
 *  level blended across the neighbouring lake cells. */
export interface LakeParams extends Partial<WaterColors> {
  /** How far the bowl sinks under the level one height-blend width in. */
  depth: number;
  /** The level stands this far under the region base at the cell's site, so the shore sits above it. */
  levelBelow: number;
  /** It stands at least this far under the NATURAL ground of the land beside it (real units; lakes/
   *  landDeficitAt), so no shore is lifted over low land: the water meets it at or under its ground… */
  levelBelowLand: number;
  /** …easing back up to its own level this much per unit away from that land (over at most 1500u): the
   *  steepest its surface tilts. */
  landGrade: number;
  /** Hummocks on the bed, as a share of `depth` (grown in with presence², so the shore is untouched)… */
  bedBumps: number;
  /** …this wide (warped units). */
  bedBumpScale: number;
  /** Land within `shoreHold` of the lake's wall is lifted onto its shore, fading back to its own relief
   *  over `shoreFade` more (real units): no land beside a lake lies under its level. The hold covers the
   *  widest height window a neighbour can draw the water across (defaultHeightBlendWidth / 2). */
  shoreHold: number;
  shoreFade: number;
  /** Rivers widen toward it: a river junction near the site of a region of lakes takes up to
   *  `riverWidening` × its width more, fading out by `riverWideningReach` (real units), in proportion to
   *  the region's share of lake. */
  riverWidening: number;
  riverWideningReach: number;
  /** A river's surface eases onto its level over this far from its wall (real units; within its
   *  `shoreHold` + `shoreFade`, past which no point measures the wall). */
  riverApproach: number;
}

/** Every <Lake> knob but its depth. The bed's hummocks were tuned on the 26u lake: ±3.5u, their peaks
 *  ≥ 20u under its level; as a share of the depth a shallower lake's never break its surface. */
export const LAKE_DEFAULTS: Omit<LakeParams, "depth"> = {
  levelBelow: 1.5,
  levelBelowLand: 1.5,
  landGrade: 0.05,
  bedBumps: 3.5 / 26,
  bedBumpScale: 70,
  shoreHold: 160,
  shoreFade: 250,
  riverWidening: 0.9,
  riverWideningReach: 5000,
  riverApproach: 250,
};

type WithFeatures = { features?: Readonly<Record<string, unknown>> };

/** A biome's <Lake> (null: it is no lake). */
export const lakeOf = (biome: WithFeatures): LakeParams | null => (biome.features?.[LAKE] as LakeParams | undefined) ?? null;
export const isLakeBiome = (biome: WithFeatures): boolean => lakeOf(biome) !== null;
/** The biomes with a <Lake> mounted. */
export const lakeBiomeIds = (): number[] => biomeIdsWith(LAKE);
/** The <Lake> body a biome carries (−1: none). */
export const lakeBodyOf = (biomeId: number): number => bodyOf(biomeId, LAKE);
