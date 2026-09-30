/** The height pipeline's data model: the serializable DomainConfig every worker, the main thread and
 *  the server initialize it with, what one vertex evaluation returns, and the interned zone/wall
 *  shapes its modules share. Three-free. */

import type { PointXZ } from "../math/types";

export interface TerrainNoiseParams {
  type: "simplex" | "perlin";
  octaves: number;
  persistence: number;
  lacunarity: number;
  exponentiation: number;
  height: number;
  scale: number;
}

/** Blend widths resolve biome → region → domain default (see CLAUDE.md "Blending"). */
export interface BlendWidths {
  /** Material feather, FULL width across the wall (the smaller side wins at a wall). */
  blendWidth?: number;
  /** Terrain-height blend, FULL width; each side contributes its own half. Falls back to blendWidth. */
  heightBlendWidth?: number;
}

export interface SerializedBiome extends BlendWidths {
  id: number;
  name: string;
  joinable: boolean;
  /** A water-filled biome: the terrain bowls `depth` below the base; the Water system fills it. */
  water?: { depth: number };
  /** No inter-city freeway along this biome's walls (see getNetwork's walkable). */
  prohibitRoads?: boolean;
  /** No river reaches this biome: a river approaching it ends in a pond first (getRiverSegments). */
  prohibitRivers?: boolean;
}

export interface SerializedRegion extends BlendWidths {
  id: number;
  name: string;
  /** VORONOI (= JSX) order. */
  biomes: SerializedBiome[];
  /** This region's base terrain; unset = the domain's baseNoiseParams. */
  baseNoise?: TerrainNoiseParams;
  /** River density: scales the chance a river-grid edge under this region carries a river
   *  (RIVER_KEEP_PER_PROBABILITY); unset = river.defaultProbability, 0 = none. */
  riverProbability?: number;
}

export interface RiverParams {
  halfWidth: number;
  depth: number;
  bank: number;
  defaultProbability: number;
}

export interface DomainConfig {
  seed: string;
  /** VORONOI (= JSX) order. */
  regions: SerializedRegion[];
  gridSize: number;
  regionGridSize: number;
  defaultBlendWidth: number;
  defaultHeightBlendWidth: number;
  roadNoiseParams: TerrainNoiseParams;
  baseNoiseParams: TerrainNoiseParams;
  river: RiverParams;
  biomeNoiseConfigs: {
    [biomeId: number]: {
      params: TerrainNoiseParams;
      absNeg?: boolean;
      scale?: number;
      offset?: number;
    };
  };
  cityConfig: {
    seed: string;
    gridSize: number; // block grid cell size
    roadWidth: number; // street half-width: road centerline (block boundary) → curb
    blockCount: number;
    maxBlockElevation: number; // per-block plateau height range [0, max]
    curbHeight: number; // road surface depth below the sidewalk
    freewayWidth: number; // arterial (district boundary road) half-width
    districtSize: number; // average district size in CELLS (sections of rotated grid)
    triangleChance: number; // probability a super-cell is split by a diagonal road
    roundaboutChance: number; // probability a super-cell is a circular block + ring road
  };
  flattenDescriptors?: FlattenDescriptor[];
}

export interface FlattenDescriptor {
  id: string;
  density: number;
  clustering: number;
  footprint: number;
  priority: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  roadDistanceRange?: [number, number];
  radius: number; // flat pad radius around the instance
  skirt: number; // blend ring width back to the raw terrain
}

export interface VertexResult {
  height: number;
  /** The biome of the vertex's own voronoi cell (spawn/foliage filters key on it). */
  biomeId: number;
  regionId: number;
  /** The own zone's normalized HEIGHT weight: 1 deep inside, ~0.5 on a wall. */
  blend: number;
  /** Distance to the nearest wall of the own zone (warped space); Infinity deep inside. */
  distanceToBiomeBoundaryCenter: number;
  /** Distance to the nearest RIVER centerline in FACTOR-1 units (the real distance ÷ the river's
   *  local width factor, so it compares against the `river` config as is); Infinity when none is in reach. */
  distanceToRiverCenter: number;
  /** What the terrain shader paints the riverbed by (factor-1 units): the river distance, except in
   *  a city, where the quay's straight bank edge bounds it (the sand starts past its sidewalk). */
  riverBedDistance: number;
  /** 1 under a bridge deck (its footprint), fading to 0 over the cut's feather beside it: nothing
   *  grows or stands there (the ground is cut just below the deck's top). */
  underDeck: number;
  distanceToRoadCenter: number;
  /** Real units; 99999 where no freeway (city arterial/belt or inter-city) is near, and in junction zones. */
  distanceToFreewayCenter: number;
  /** Lane-paint dash phase along that freeway; 0 outside. */
  freewayAlong: number;
  /** Water SURFACE height at this point (lake level or river surface), or NaN where there is no water in reach. */
  waterHeight: number;
  /** Per BIOME SLOT (getBiomeSlots order): signed distance to that biome's material,
   *  scaled by the wall's half feather — the shader's weight is smoothstep(-1, 1, sdf).
   *  ±BIOME_SDF_FAR when no wall is in reach. Shared scratch buffer: copy, don't keep. */
  biomeSdf: Float64Array;
  /** Per BIOME SLOT: signed distance to that biome's own boundary scaled by its blend
   *  width — the shader's PRESENCE is smoothstep(0, 1, v): 0 at the biome's edge (the
   *  region's base material shows), 1 one blend width inside. Shared scratch: copy. */
  biomePresence: Float64Array;
}

/** A (region, biome) pair — the unit the height blend works in. Interned at init so
 *  cells and walls compare by identity. */
export interface Zone {
  index: number;
  region: SerializedRegion;
  regionIndex: number;
  biome: SerializedBiome;
  /** Index into the biome-slot list (biome id → slot). */
  slot: number;
  /** HALF the resolved material feather. */
  blendHalf: number;
  /** HALF the resolved height blend width — this zone's contribution on its own side of a wall. */
  heightHalf: number;
  /** The biome's PRESENCE widths: how far inside its own boundary the biome takes over the region base. */
  presenceWidth: number;
  heightPresenceWidth: number;
  /** A crisp zone (city) keeps full presence everywhere, including as seen from a neighbor. */
  crisp: boolean;
  baseNoise: TerrainNoiseParams;
}

/** A voronoi wall segment on the horizontal plane (warped space) between two zones. */
export interface Wall {
  sx: number;
  sz: number;
  ex: number;
  ez: number;
  a: Zone;
  b: Zone;
  /** Unit normal pointing from a's cell toward b's cell (which side is which). */
  nx: number;
  nz: number;
  /** min(a.blendHalf, b.blendHalf); -1 when both sides are the same biome (no material feather). */
  materialHalf: number;
}

/** A voronoi grid cell: its site, what it rolled (a region, or a Zone on the biome grid) and its index. */
export interface VoronoiCell {
  point: PointXZ;
  element: any;
  ix: number;
  iz: number;
}

export interface GridCell {
  ix: number;
  iz: number;
}

/** The river field from a STRAIGHT (un-meandered) point — what the city's quay roads follow: the
 *  real distance to the river (Infinity when none is in reach), its width factor, and the unit
 *  direction toward it. */
export interface RiverQuaySample {
  distance: number;
  factor: number;
  dirX: number;
  dirZ: number;
}

/** Where a warped point sits on the biome grid: its zone and cell, the 5×5 grid around it and the
 *  grid's zone walls (the cell's freeway network is networkOf(ctx), built on first use). */
export interface BiomeContext {
  zone: Zone;
  cell: VoronoiCell;
  zoneWalls: Wall[];
  grid: VoronoiCell[];
  warped: PointXZ;
}
