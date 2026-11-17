import type { DoorHandle, DoorLeafBox } from "../../doors/types";
import { ActorAttributes } from "../../types";
import { ActorProps } from "../spawning/types";
import { LIGHT_TYPE, ROOF_STYLE, WINDOW_SHAPE } from "./enums";
import * as THREE from "three";
import type { RampCollider } from "./interior/types";

export type { DoorHandle } from "../../doors/types";

export type WallSide = "+z" | "-z" | "+x" | "-x";

export interface DoorSpec {
  side: WallSide;
  /** Door-center coordinate along the wall axis: x for ±z walls, z for ±x. */
  offset: number;
  width: number;
  height: number;
}

/** A shell door: placement plus the carve location (ring edge of lofts[0] + param range). */
export interface DoorPlan extends DoorSpec {
  position: [number, number, number];
  yaw: number;
  edge: number;
  t0: number;
  t1: number;
}

/** Horizontal cross-section ring at height y. halfWidth/halfDepth are half-extents: rect
 *  corners for boxy lofts, ellipse radii for round ones. */
export interface RingLevel {
  y: number;
  cx: number;
  cz: number;
  halfWidth: number;
  halfDepth: number;
}

/** One exterior mass. Walls are lofted ring-to-ring, so lean, taper/bulge and
 *  same-y radius jumps (lips) all fall out of the level list. */
export interface ExteriorLoft {
  rect: boolean;
  sides: number;
  /** Ring rotation for polygon lofts. */
  ringRotation: number;
  levels: RingLevel[];
  /** Explicit rings, one per level (only `y` is read from the level), for shapes no RingLevel
   *  describes — the hip roof's skeleton. Equal point counts; coincident points are allowed. */
  points?: [number, number][][];
  color: number;
  /** False when the next loft covers the top ring. */
  hasRoofFan: boolean;
}

export interface WindowSpec {
  loft: number;
  edge: number;
  /** Center param along ring edge `edge`. */
  edgeParam: number;
  y: number;
  w: number;
  h: number;
  round: boolean;
  /** Horizontal shear of a quad window's top edge (world units); 0 for round. */
  skew: number;
  /** Max fraction of the facet edge this window may span, so windows sharing a facet never merge as it tapers. */
  maxFrac: number;
  glass: number;
  frame: number;
  /** Stable per-window random; hashed with the per-night seed by the window-lights shader. */
  lightRandom: number;
}

export interface RoomRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Doubles 1:1 as a cuboid collider. */
export interface WallBox {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  rotY?: number;
}

/** Interior-local space. */
export interface ChildSlot {
  position: [number, number, number];
  rotationY: number;
  roomIndex: number;
}

/** One straight-run ramp flight from `story` to story+1; BSP walls, pillars,
 *  doorways, lights and child slots all avoid `rect`. */
export interface RampSpec {
  story: number;
  /** Full shaft footprint on `story`'s floor: bottom landing + run + top landing. */
  rect: RoomRect;
  /** Slab cutout in story+1's floor — the lane over the run only. */
  hole: RoomRect;
  /** Top landing on story+1, kept clear of walls. */
  landing: RoomRect;
  axis: "x" | "z";
  dir: 1 | -1;
  /** Along `axis`; runEnd − runStart is signed by `dir`. */
  runStart: number;
  runEnd: number;
  /** Lane extent across `axis`. */
  lane0: number;
  lane1: number;
}

/** Unset entries derive from the exterior ground-segment color. */
export interface InteriorColors {
  wall?: number;
  floor?: number;
  ceiling?: number;
  ramp?: number;
}

export interface InteriorPlan {
  /** Bounding box of the interior footprint (the perimeter is an N-gon matching the exterior). */
  width: number;
  depth: number;
  ceilingHeight: number;
  colors: { wall: number; floor: number; ceiling: number; ramp: number };
  stories: number;
  /** ceilingHeight + slab thickness — story s floor top sits at s*storyHeight. */
  storyHeight: number;
  /** Each floor rolls its own room count and BSP splits. */
  roomsPerStory: RoomRect[][];
  /** Story-local y. The PERIMETER has no wall boxes — it is the shell's inner surface. */
  wallBoxesPerStory: WallBox[][];
  /** ramps[g] climbs story g → g+1. */
  ramps: RampSpec[];
  lightType: LIGHT_TYPE;
  /** Ceiling light centers [x, z] per story, drawn as `lightType`. */
  lightsPerStory: [number, number][][];
  childSlots: ChildSlot[];
}

export interface BuildingPlan {
  seed: string;
  /** Exterior [width, depth] at ground level. */
  footprint: [number, number];
  height: number;
  /** Walls stay vertical up to here so door openings sit in flat wall. */
  doorBandTop: number;
  /** Walls extend this far below y=0 so a slight terrain slope shows no gap. */
  foundationDepth: number;
  lofts: ExteriorLoft[];
  /** lofts[0..bodyLoftCount-1] hold the interior; the rest are caps and pipes. */
  bodyLoftCount: number;
  doors: DoorPlan[];
  doorColor: number;
  doorHandle: DoorHandle;
  windowLightChance: number;
  windowLightIntensity: number;
  windows: WindowSpec[];
  interior: InteriorPlan;
}

/** Both defaults use per-building baked vertex colors; a custom material must respect or deliberately ignore them. */
export interface BuildingMaterials {
  exterior?: THREE.Material;
  interior?: THREE.Material;
}

export interface BuildingAttributes extends ActorAttributes {
  /** [width, height, depth] at ground level. */
  exteriorSize?: [number, number, number];
  /** 4 = boxy slab, 3 and 5–8 = faceted canister. Default [4, 5, 6, 7, 8]. */
  numberOfSides?: number[];
  /** [min, max] multiplier on the room-sized footprint, one roll for both axes (default [1, 1.5]). */
  widthScale?: [number, number];
  /** [min, max] depth ÷ width of the plan, any story count. Default 0.8–1.25 (1 story), 0.92–1.08 (more). */
  aspectRange?: [number, number];
  /** Default FLAT. */
  roof?: ROOF_STYLE;
  /** Ceiling fixtures (default PANEL). */
  lightType?: LIGHT_TYPE;
  /** PITCHED roof colors (default dark shingles). */
  roofColors?: number[];
  palette?: number[];
  accentColors?: number[];
  /** Chance the primary color is an accent (default 0.2). */
  accentChance?: number;
  /** Default [SQUARE]; CIRCLE is opt-in. */
  windowShapes?: WINDOW_SHAPE[];
  /** Unset = a seeded fill fraction of the available slots. */
  windowCount?: number[];
  /** Window width range [min, max] (default [2.4, 4.4]). */
  windowSize?: [number, number];
  /** Fraction of exterior height (default 0.08). */
  maxLean?: number;
  /** Overrides the floors-derived height (clamped to fit them) — NOT the terrain-height spawn filter `heightRange`. */
  shellHeightRange?: [number, number];
  /** A count, or CHOICES one is picked from. Default seeded 1–5. */
  stories?: number | number[];
  /** Each floor rolls its own count from an array; the LARGEST choice sizes the footprint. Default seeded 3–6. */
  roomCount?: number | number[];
  doorCount?: 1 | 2;
  /** [width, height]; height is clamped below the ceiling. */
  doorSize?: [number, number];
  ceilingHeight?: number;
  /** Fraction of windows lit per night, a different subset each night. 0 = never. Default 0.6. */
  windowLightChance?: number;
  /** Emissive multiplier of lit glass. Default 1.4. */
  windowLightIntensity?: number;
  interiorColors?: InteriorColors;
}

export interface BuildingProps extends ActorProps<BuildingAttributes> {
  /** Defaults to the spawn coordinates. */
  seed?: string | number;
  materials?: BuildingMaterials;
  children?: React.ReactNode;
}

export type Pt2 = [number, number];

/** The plan's one seeded random stream. */
export interface PlanRng {
  (): number;
  range(a: number, b: number): number;
  rangeInt(a: number, b: number): number;
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[];
}

/** Everything the phases after sizing share: the shell's shape, the story dimensions, the interior
 *  footprint and the BSP domain rooms are split within. */
export interface Massing {
  pitched: boolean;
  sides: number;
  rect: boolean;
  ringRotation: number;
  ceilingHeight: number;
  storyHeight: number;
  doorWidth: number;
  doorHeight: number;
  doorBandTop: number;
  /** After the ramp fit — may be fewer than requested. */
  stories: number;
  requestedStories: number;
  pickRoomCount: () => number;
  rampRun: number;
  shaftLen: number;
  interiorHalfWidth: number;
  interiorHalfDepth: number;
  /** Exterior half-extents at ground level. */
  halfWidth: number;
  halfDepth: number;
  /** The interior perimeter polygon. */
  intPts: Pt2[];
  /** The BSP domain: only room BOOKKEEPING — split walls are later stretched past it to the shell's
   *  inner surface (no enclosed room-within-a-room). */
  bsp: RoomRect;
}

export type Vec3 = [number, number, number];

export interface DoorPlacement {
  position: Vec3;
  /** +z faces out of the building. */
  yaw: number;
  width: number;
  height: number;
}

export interface ProceduralBuildingAssets {
  plan: BuildingPlan;
  exteriorGeometry: THREE.BufferGeometry;
  /** Body triangles only (windows excluded), so door openings are walkable. */
  exteriorVertices: Float32Array;
  exteriorIndices: Uint32Array;
  /** Wall/pillar cuboids; slabs are the trimesh below. (The interior MESH is not here: it is built
   *  only for buildings the player walks up to — beginBuildingInteriorBuild.) */
  interiorColliders: WallBox[];
  rampColliders: RampCollider[];
  interiorSlabVertices: Float32Array;
  interiorSlabIndices: Uint32Array;
  /** Origin = hinge edge, leaf extends +x, so rotating the parent group swings it (objects/doors). */
  doorGeometry: THREE.BufferGeometry;
  /** The same leaf as a box (hinge-relative center + size + color) for the far-door instances. */
  doorLeaf: DoorLeafBox;
  doors: DoorPlacement[];
  /** Plain typed array — nothing to dispose (see objects/actors/building/collider/index.ts). */
  proxyHullVertices: Float32Array;
}

// REFCOUNTED: the city mounts 300-600 buildings, and an eviction that ignored
// mounts would dispose geometry still on live meshes.
export interface BuildingCacheEntry {
  assets: ProceduralBuildingAssets;
  /** Walls, slabs, ramps and ceiling lights as ONE vertex-colored geometry; null until someone needs it.
   *  Lives exactly while the building is mounted: disposed when the refcount drops to 0. */
  interior: THREE.BufferGeometry | null;
  refCount: number;
  /** Monotonic tick of the last drop to refcount 0 — eviction order. */
  releasedAt: number;
}

export interface FarDoorSpec {
  /** Where the door's hinge group sits in the world: building coordinates + the plan's door position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Door opening width: the hinge is at -width/2 along the door's x. */
  width: number;
  /** The leaf box relative to the hinge (ProceduralBuildingAssets.doorLeaf). */
  leafCenter: [number, number, number];
  leafSize: [number, number, number];
  color: number;
}

export interface FarDoor extends FarDoorSpec {
  angle: number;
  /** Its building's spawn-fade visibility (the per-instance aSpawnFade). */
  fade: number;
  index: number;
}
