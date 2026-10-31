import type { BiomeDomeConfig, TerrainNoiseParams } from "../utils/workers/types";

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
  /** Draw the terrain as its triangles' edges only, in each biome's <Material> (a flat world's grid). */
  wireframe: boolean;
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
  /** A domed biome is ROCK: rivers build through it, its banks end a riverbed, caves open in it. */
  dome?: BiomeDomeConfig;
  /** Layers added linearly at every depth (a domed biome's foot keeps them). */
  detail?: TerrainNoiseParams[];
}

/** A water-filled biome (lakes, seas): the terrain bowls `depth` below the region base and the
 *  Water system fills it to the level of the base at the cell's site. */
export interface BiomeWaterConfig {
  depth: number;
}

/** THE CLIENT LOOK MODEL — what the one terrain material is assembled from, read off the content
 *  tree at the commit (world/components/Domain.tsx). Everything the GENERATION side needs is the
 *  DomainConfig instead (world/content/config.ts), which the server shares. */
export interface Biome {
  id: number;
  name: string;
  /** This biome's own fragment shader, from its <Material>. */
  getMaterial?: () => Promise<MaterialData>;
  riverbed?: RiverbedMaterial;
}

export interface Region {
  id: number;
  name: string;
  /** VORONOI (= JSX) order. */
  biomes: Biome[];
  /** The region's BASE material — what its biomes fade into at their edges. */
  getMaterial?: () => Promise<MaterialData>;
}
