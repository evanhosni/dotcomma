/** WATER's data model: the base and its bodies as the config lists them, the shape every carved
 *  channel shares, and what one vertex's water step reads. Three-free. */

import type { BiomeContext } from "../types";

/** The <Water> BASE as the config holds it (DomainConfig.water): its own params and its PARTS — what
 *  follows every water whatever body it is (a fall's spray, its boulders), by kind. */
export interface WaterBase {
  params: WaterParams;
  parts: Readonly<Record<string, unknown>>;
}

/** <Water>'s own knobs: what every water shares, the colours of any body that names none, and the
 *  domain-wide DEFAULTS of each body kind's shape props, by the kind ("rivers", "lake", "pond") — under every
 *  mount's own and over the kind's code defaults. */
export interface WaterParams extends WaterColors {
  /** A river piece falling faster than this (rise per unit) is a FALL: its boulders, its white water. */
  fallGrade: number;
  defaults?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** An RGB colour, each channel 0–1. */
export type WaterColor = readonly [number, number, number];
/** The colours of a body's water (the sheet's material): `shallowColor` at the shore, `deepColor` from
 *  `deepDepth` (real units) of water down. */
export interface WaterColors {
  shallowColor: WaterColor;
  deepColor: WaterColor;
  deepDepth: number;
}
/** The same as a mount writes them: a colour is "#rrggbb" or an RGB triple. */
export interface WaterColorProps {
  shallowColor?: string | WaterColor;
  deepColor?: string | WaterColor;
  deepDepth?: number;
}

/** One body of WATER the content tree mounts (DomainConfig.waterBodies): a <Lake>, a <Rivers> or a <Pond>,
 *  on a region or a biome. Every body has the same shape (world/components/Water.tsx): its own resolved
 *  params, and its PARTS — the declarations mounted inside it (a lake's bubbles), by kind, with their
 *  resolved params. A vertex names the bodies its water belongs to by their index in the list
 *  (VertexResult.waterBody). */
export interface WaterBody {
  /** Its declaration's kind. */
  kind: string;
  /** Its path segment ("lake", "rivers", "pond:pond"): what a biome mount overrides its region's by, and
   *  what an <Actor> inside it is placed by (featurePlacement.ts). */
  id: string;
  /** Where it is mounted: a region (it is every biome's there that does not mount the same id) or a biome. */
  regionId?: number;
  biomeId?: number;
  params: unknown;
  parts: Readonly<Record<string, unknown>>;
}

/** The WALLS of a carved channel (a river's, a pond's): the ground beside it is cut back to a slope rising
 *  `wallGrade` (rise per real unit) from its water band, easing back into the natural ground from
 *  `wallEase` to `wallReach` past the band (real units). */
export interface WallShape {
  wallGrade: number;
  wallEase: number;
  wallReach: number;
}

/** Bumpy banks (<Banks/>, a part of a <Rivers> or a <Pond>): a bank held up over low ground (a levee)
 *  takes the biome's OWN noise as relief (water/channel/). Unmounted = a smooth bank. */
export interface BankReliefParams {
  /** The share of the biome's noise the bank takes. */
  share: number;
  /** The same noise read this many times finer… */
  fineScale: number;
  /** …at this share of it. */
  fineShare: number;
  /** The relief fades in as the drop the bank is held over grows from `dropStart` to `dropFull` (real
   *  units), and grows ×(1 + drop / `dropScale`), the drop counted up to `dropCap`. */
  dropStart: number;
  dropFull: number;
  dropScale: number;
  dropCap: number;
}

/** The levee relief at one vertex (water/channel bankReliefAt): per distinct drop gate of the domain's
 *  <Banks/>, the folded noise amount the bank takes. `any` false: a smooth bank. */
export interface BankRelief {
  readonly amounts: Float64Array;
  readonly any: boolean;
}

/** A ZONE of a body of water a part stands in (params.ts waterZoneOf). */
export type WaterZone = "submerged" | "shallows" | "bank";

/** A body a part is mounted in, by its DomainConfig.waterBodies slot, and the zone it stands in. */
export interface ZonedBody {
  slot: number;
  zone: WaterZone;
}

/** What step 4 of computeVertexData hands the water (water/index.ts resolveWater): the vertex after step
 *  3, its river field as step 2 read it, and what the roads and the biome's own banks say there. */
export interface WaterContext {
  /** The vertex (world). */
  x: number;
  z: number;
  /** The ground after step 3. */
  height: number;
  /** The bed paint distance so far (factor-1 units). */
  riverBedDistance: number;
  /** The river field as step 2 read it (rivers/field.ts riverSample): the factor-1 distance, the width
   *  factor, every wall in reach, the discs' depth scale, and the heaviest disc's body and the discs'
   *  share of the field. */
  distance: number;
  factor: number;
  walls: readonly number[];
  discDepth: number;
  pondBody: number;
  pondShare: number;
  biome: BiomeContext;
  // THE QUAY AND ROAD INPUT: what the biome's own banks and the roads say here (vertexCompute reads them;
  // the water never asks a road module for them).
  /** The own zone's weight where its biome keeps its own banks (<Quays/>), else 0. */
  ownBanksWeight: number;
  /** Off such a biome, the share of the river's own bank rules (walls, bed limit) that applies: 0 where the
   *  city's quay holds the vertex beside its wall, rising over the handoff past it; 1 elsewhere. */
  riverBanksShare: number;
  /** The curb dip of the street under the vertex in a road-bearing biome (0 off its streets), dipped
   *  under any shore lift. */
  streetCurbDip: number;
  /** The real distance to the nearest freeway: an inter-city run, or the belt on a road-bearing biome's
   *  wall, measured from that wall even where a drowned belt is pushed off it (Infinity: none in reach). */
  freewayDistance: number;
  /** The real distance to the nearest belt (a road-bearing biome's wall, Infinity: none in reach): a river's
   *  walls give way to it, not to a run, whose grade rides the carved ground (roads/freewayGrade.ts). */
  beltDistance: number;
}

/** A POND in the river field (ponds/ places it, rivers/field.ts measures it): its centre (warped), its
 *  waterline radius in factor-1 units (`width` × the river's half-width is real), its level, its depth
 *  scale, its waterline wobble (`amount` of the width over `lobes` around, at `phase`) and the
 *  DomainConfig.waterBodies slot that owns all of it: its <Pond>'s. */
export interface FieldDisc {
  x: number;
  z: number;
  width: number;
  level: number;
  depth: number;
  amount: number;
  lobes: number;
  phase: number;
  body: number;
}
