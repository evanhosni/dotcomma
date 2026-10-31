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

/** A biome's declarative height (its <Terrain noise>), before its presence: the noise, the dome,
 *  the detail layers, then the offset (noise.ts biomeNoiseHeight). */
export interface BiomeNoiseConfig {
  params: TerrainNoiseParams;
  absNeg?: boolean;
  scale?: number;
  offset?: number;
  dome?: BiomeDomeConfig;
  /** Layers added LINEARLY to the shaped height at every depth — never squared by the exponentiation,
   *  never faded by a dome's noise floor — so a domed biome's foot carries small bumps too. */
  detail?: TerrainNoiseParams[];
}

/** A MASSIF under a biome's noise: the ground rises with the square of the point's depth inside the
 *  biome, by `height` at `reach`. Depth is measured to the nearest FOREIGN wall, so a group of joined
 *  cells is one mass whose summit is where the group is deepest (zoneBlend.ts domeDepthAt). A domed
 *  biome is ROCK to every system that asks (biomeFlags.ts isRockBiome). */
export interface BiomeDomeConfig {
  height: number;
  /** Depth (warped units) at which the dome reaches `height`; deeper ground stays there. */
  reach: number;
  /** The noise's share at the edge (default 1); it grows to all of it with the dome. */
  noiseFloor?: number;
}

/** Blend widths resolve biome → region → domain default (see CLAUDE.md "Blending"). */
export interface BlendWidths {
  /** Material feather, FULL width across the wall (the smaller side wins at a wall). */
  blendWidth?: number;
  /** Terrain-height blend, FULL width; each side contributes its own half. Falls back to blendWidth. */
  heightBlendWidth?: number;
}

/** Snow on a biome (`snow: true | {…}` on its spec): the snow line and the altitude band in GROUND HEIGHT
 *  (real units) and the pile depth's scale. Defaults: snow/snowParams.ts. */
export interface SnowParams {
  /** Below `lineLow` nothing lies; whole from `lineHigh` up. */
  lineLow: number;
  lineHigh: number;
  /** The altitude term (deeper, flatter-shouldered snow) is 0 at `altitudeLow`, 1 from `altitudeHigh`. */
  altitudeLow: number;
  altitudeHigh: number;
  /** Multiplies every pile depth (the 1.85u cap stays). */
  depthScale: number;
}

/** Caves under a biome (a <Caves> in its spec's `features`): the chance a cell holds a system, and the
 *  rooms its <CaveSideRoom> child adds (null: none). */
export interface CaveParams {
  chance: number;
  sideRooms: CaveSideRoomParams | null;
}

/** <CaveSideRoom>: the chance of a room on the trunk (clear of the mouths) and at each branch's tip. */
export interface CaveSideRoomParams {
  trunkChance: number;
  tipChance: number;
}

/** Sewers under a street-bearing biome, registered by its <Sewers> mount: the chance a cell holds a
 *  system, and the side rooms its <SewerSideRoom> child adds (null: none). */
export interface SewerParams {
  chance: number;
  sideRooms: SewerSideRoomParams | null;
}

/** <SewerSideRoom>: the chance a junction gets a door into a side room (kept only where the room fits). */
export interface SewerSideRoomParams {
  chance: number;
}

/** Rocks on a biome (`rocks: true | {…}`): a density field kept by slope, and the rock's texture. */
export interface RockParams {
  /** Rocks per km². */
  density: number;
  footprint: number;
  sizeMin: number;
  sizeMax: number;
  /** The share of flat points kept; every point is kept between `startDeg` and `fullDeg` of slope. */
  flatKeep: number;
  startDeg: number;
  fullDeg: number;
  /** Filename under public/textures/. */
  texture: string;
}

/** Bumpy river banks on a biome (`riverBankRelief: true | {…}`): a bank held up over low ground (a levee)
 *  takes the biome's OWN noise as relief (rivers/riverChannel.ts riverBankBump). Unset = a smooth bank. */
export interface RiverBankReliefParams {
  /** The share of the biome's noise the bank takes. */
  share: number;
  /** The same noise read this many times finer… */
  fineScale: number;
  /** …at this share of it. */
  fineShare: number;
}

export interface SerializedBiome extends BlendWidths {
  id: number;
  name: string;
  joinable: boolean;
  /** A water-filled biome: the terrain bowls `depth` below the base; the Water system fills it. */
  water?: { depth: number };
  /** No inter-city freeway along this biome's walls (see getNetwork's walkable). DERIVED from
   *  `water`: impassable ground is the only reason, and a second flag could only disagree. */
  prohibitRoads?: boolean;
  /** EVERY feature mounted in the biome, keyed by its declaration's kind, holding that
   *  declaration's resolved params. A key is present because a component was mounted
   *  (world/content/) — nothing here is a flag anyone can set beside the mounting, and nothing
   *  downstream keys on a biome's id or name. Read through biomeFlags.ts. */
  features: Readonly<Record<string, unknown>>;
}

export interface SerializedRegion extends BlendWidths {
  id: number;
  name: string;
  /** VORONOI (= JSX) order. */
  biomes: SerializedBiome[];
  /** This region's base terrain; unset = the domain's baseNoiseParams. */
  baseNoise?: TerrainNoiseParams;
  /** River density: scales the chance a river-grid edge under this region carries a river
   *  (RIVER_KEEP_PER_PROBABILITY). 0 = the region mounted no <Rivers/> and has none. */
  riverProbability: number;
}

export interface RiverParams {
  halfWidth: number;
  depth: number;
  bank: number;
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
  biomeNoiseConfigs: { [biomeId: number]: BiomeNoiseConfig };
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
  /** The height before step 9 had the road not given way to a river: a deck landing's approach lays
   *  the road there (bridges/deckGround.ts), and its landed ends sit on it (bridges/landings.ts). */
  approachHeight: number;
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
  /** Real units; NO_ROAD_DISTANCE (99999) where no freeway (city arterial/belt or inter-city) is near, and in junction zones. */
  distanceToFreewayCenter: number;
  /** Lane-paint dash phase along that freeway; 0 outside. */
  freewayAlong: number;
  /** Water SURFACE height at this point (lake level, river surface, a spring cave's water), or NaN where
   *  there is no water in reach. */
  waterHeight: number;
  /** How deep the water stands over the ground (0 where dry). NEGATIVE within the cave-water margin of
   *  a spring cave's water: a DIVE toward that water's level, clamped under the ground — the water sheet
   *  dives there, and every "water over the ground" test reads it as dry. */
  waterDepth: number;
  /** The water's flow (downhill along a river, scaled by its grade; 0 on a lake and over a mouth; a
   *  spring cave's own under the mountain), carried to the water shader. */
  waterFlowX: number;
  waterFlowZ: number;
  /** Per BIOME SLOT (getBiomeSlots order): signed distance to that biome's material,
   *  scaled by the wall's half feather — the shader's weight is smoothstep(-1, 1, sdf).
   *  ±BIOME_SDF_FAR when no wall is in reach. Shared scratch buffer: copy, don't keep. */
  biomeSdf: Float64Array;
  /** Per BIOME SLOT: signed distance to that biome's own boundary scaled by its blend
   *  width — the shader's PRESENCE is smoothstep(0, 1, v): 0 at the biome's edge (the
   *  region's base material shows), 1 one blend width inside. Shared scratch: copy. */
  biomePresence: Float64Array;
  /** Per BIOME SLOT: biomeSdf for the riverbed's texture, each wall's half floored at
   *  RIVER_BED_TEXTURE_HALF (zoneBlend.ts), so the bed cross-fades softly even beside the crisp
   *  city. Shared scratch: copy. */
  riverbedSdf: Float64Array;
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
