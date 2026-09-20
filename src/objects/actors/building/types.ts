import type * as THREE from "three";
import { ActorAttributes } from "../../types";
import { ActorProps } from "../spawning/types";

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
 *  doorways, light panels and child slots all avoid `rect`. */
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
  /** Ceiling light panel centers [x, z] per story. */
  lightPanelsPerStory: [number, number][][];
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

export enum WINDOW_SHAPE {
  CIRCLE = "circle",
  SQUARE = "square",
}

/** Generation knobs; anything unset is seeded-random per building. Array
 *  knobs are CHOICES, one picked per building (or per floor for roomCount). */
export interface BuildingAttributes extends ActorAttributes {
  /** [width, height, depth] at ground level. */
  exteriorSize?: [number, number, number];
  /** 4 = boxy slab, 5–8 = faceted canister. Default [4, 5, 6, 7, 8]. */
  numberOfSides?: number[];
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
  /** Default seeded 1–5. */
  stories?: number;
  /** Each floor rolls its own count from an array; the LARGEST choice sizes the footprint. Default seeded 3–6. */
  roomCount?: number | number[];
  doorCount?: 1 | 2;
  /** [width, height]; height is clamped below the ceiling. */
  doorSize?: [number, number];
  ceilingHeight?: number;
  /** Fraction of windows lit per night, a different subset each night. 0 = never. Default 0.2. */
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
