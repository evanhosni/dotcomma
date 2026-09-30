import type { ActorMount } from "../objects/actors/spec";
import type { AnyActorDescriptor } from "../objects/actors/spawning/types";
import type { TerrainNoiseParams } from "../utils/workers/vertexCompute";

/** City terrain knobs — the layout itself is documented in CLAUDE.md. */
export interface CityConfig {
  seed: string;
  /** Block grid cell size. */
  gridSize: number;
  /** Street HALF-width (centerline → curb). Must match the city fragment shader's band constants. */
  roadWidth: number;
  blockCount: number;
  /** Each block index rolls a seeded plateau elevation in [0, max]. */
  maxBlockElevation: number;
  /** Road surface depth below the sidewalk. */
  curbHeight: number;
  /** Arterial (district boundary road) HALF-width — also every inter-city freeway's. */
  freewayWidth: number;
  /** Average district size in CELLS (actual ~0.6–1.4×). */
  districtSize: number;
  /** Probability a 2×2 super-cell is split by a diagonal road into two flatirons. */
  triangleChance: number;
  /** Probability a 2×2 super-cell becomes a roundabout island + ring road. */
  roundaboutChance: number;
}

/** A factor-1 river (every river scales these by its local width factor; see CLAUDE.md "Rivers"). */
export interface RiverConfig {
  /** Water surface HALF-width from the river's centerline. */
  halfWidth: number;
  /** Channel depth below the water surface at the centerline. */
  depth: number;
  /** Bank: the channel blends back to the terrain over this many units past halfWidth. */
  bank: number;
  /** Fallback for regions that set no `riverProbability`; 0 everywhere = no rivers in the domain. */
  defaultProbability: number;
}

/** Blend widths at biome or region level; unset = inherit from the level above. */
export interface BlendWidthProps {
  /** Material feather across a wall to a DIFFERENT biome, full width. The smaller side wins. */
  blendWidth?: number;
  /** Terrain-height blend, full width; each side contributes its own half. Falls back to blendWidth. */
  heightBlendWidth?: number;
}

export interface TerrainParams {
  seed: string;
  gridSize: number;
  regionGridSize: number;
  /** Domain-level fallback for every zone's material feather. */
  defaultBlendWidth: number;
  /** Domain-level fallback for every zone's height blend. */
  defaultHeightBlendWidth: number;
  roadNoise: TerrainNoiseParams;
  /** Fallback regional base noise for regions that set none. */
  baseNoise: TerrainNoiseParams;
  river: RiverConfig;
  cityConfig: CityConfig;
}

export interface MaterialData {
  uniforms: any;
  fragmentShader: string;
}

/** A biome's RIVERBED look (<Material riverbed> under a <Biome>): what the terrain paints under a
 *  river's water and on its banks there, cross-faded by the same biome weights as the ground. A
 *  biome without one uses the domain's river texture. Textures are deduped by filename. */
export interface RiverbedMaterial {
  /** Filename under public/textures/. */
  texture: string;
  /** 0 = grayscale, 1 = the texture's own color (default). */
  saturation?: number;
  /** Multiplied onto the (desaturated) texture; default [1, 1, 1]. */
  tint?: [number, number, number];
}

/** A biome's height definition — evaluated by the ONE shared pipeline (vertexCompute.ts). */
export interface BiomeNoiseConfig {
  params: TerrainNoiseParams;
  absNeg?: boolean;
  scale?: number;
  offset?: number;
}

/** A water-filled biome (lakes): the terrain bowls `depth` below the region base and the
 *  Water system fills it to the level of the base at the cell's site. */
export interface BiomeWaterConfig {
  depth: number;
}

/** What a biome folder's `spec.ts` exports — read by the JSX and by the server's shared config. */
export interface BiomeSpec extends BlendWidthProps {
  /** Unique across the domain (a biome shared by two regions keeps one id). */
  id: number;
  /** Unique across the domain, lowercase letters only: the `/<region>/<name>` address word, the
   *  `<name>_frag` shader function and the key of the region's `biomes` component map. */
  name: string;
  joinable: boolean;
  /** Omitted by biomes with bespoke height code (city → branch in vertexCompute.ts). */
  noise?: BiomeNoiseConfig;
  water?: BiomeWaterConfig;
  /** No inter-city freeway may run along this biome's walls (its own belt causeway is unaffected). */
  prohibitRoads?: boolean;
  /** No river reaches this biome: one approaching it ends in a pond before its footprint gets there. */
  prohibitRivers?: boolean;
  /** The actors spawned from this biome, with this biome's overrides — read by <Biome> (the client
   *  registrations) and by the domain's config.ts (the flatten pads the server's terrain needs). */
  actors?: ActorMount[];
}

/** A region's own fields — what RegionSpec and the committed Region share. */
export interface RegionSpecBase extends BlendWidthProps {
  /** Unique across the domain. */
  id: number;
  /** Unique across the domain, lowercase letters only: the `/<name>` address word, the
   *  `<name>_base_frag` shader function and the key of the domain's region component map. */
  name: string;
  /** This region's base terrain; unset = the domain's baseNoise. */
  baseNoise?: TerrainNoiseParams;
  /** River density under this region: scales each river-grid edge's chance to carry a river (CLAUDE.md "Rivers"). */
  riverProbability?: number;
}

/** What a region folder's `spec.ts` exports. */
export interface RegionSpec extends RegionSpecBase {
  /** VORONOI order: the biome roll is `floor(u × count)` over this list, and <Region> renders in it. */
  biomes: BiomeSpec[];
}

export interface Region extends RegionSpecBase {
  biomes: Biome[];
  /** The region's BASE material — what its biomes fade into at their edges. */
  getMaterial?: () => Promise<MaterialData>;
}
export interface Biome extends Omit<BiomeSpec, "actors"> {
  getMaterial?: () => Promise<MaterialData>;
  riverbed?: RiverbedMaterial;
  /** Registered by <Actor>; dressing/foliage are not part of the data model. */
  actors?: AnyActorDescriptor[];
}
