import * as THREE from "three";
import { ActorAttributes } from "../../types";
import { ActorProps } from "../spawning/types";

/** Which exterior/interior wall a door lives on (+z = local south face, etc). */
export type WallSide = "+z" | "-z" | "+x" | "-x";

/** A door opening on the interior perimeter wall (exit portal). `offset` is
 *  the door-center coordinate along the wall axis: x for ±z walls, z for ±x. */
export interface DoorSpec {
  side: WallSide;
  offset: number;
  width: number;
  height: number;
}

/** A door on the exterior shell. Carries the enter-portal placement plus the
 *  carve location (edge of lofts[0]'s ring + param range along that edge),
 *  and the side/offset mapping used to place the paired interior exit door. */
export interface DoorPlan extends DoorSpec {
  position: [number, number, number];
  yaw: number;
  edge: number;
  t0: number;
  t1: number;
}

/** Horizontal cross-section ring of an exterior mass at a given height.
 *  hw/hd are half-extents: rect corners for boxy lofts, ellipse radii for
 *  round ones. */
export interface RingLevel {
  y: number;
  cx: number;
  cz: number;
  hw: number;
  hd: number;
}

/** One exterior mass — door band, a colored body segment, a rooftop cap, or a
 *  pipe. Walls are lofted ring-to-ring, so shear (lean), scale (taper/bulge)
 *  and same-y radius jumps (canister lips) all fall out of the level list. */
export interface ExteriorLoft {
  rect: boolean;
  /** Ring vertex count for polygon lofts (rect lofts always use 4 corners). */
  sides: number;
  /** Ring rotation for polygon lofts, so facets don't all face the same way. */
  phase: number;
  levels: RingLevel[];
  color: number;
  /** Emit a roof fan over the top ring (false when the next loft covers it). */
  roof: boolean;
}

/** A porthole (round/oval) or quad window on an exterior loft facet. `t` is
 *  the center param along ring edge `edge`; w/h are world-unit sizes, clamped
 *  to the window's slot at emission time via `maxFrac`. */
export interface WindowSpec {
  loft: number;
  edge: number;
  t: number;
  y: number;
  w: number;
  h: number;
  round: boolean;
  /** Horizontal shear of a quad window's top edge (world units) — keeps most
   *  windows subtly asymmetric. 0 for round windows. */
  skew: number;
  /** Max fraction of the facet edge this window may span (0.8 / slots on its
   *  edge), so windows sharing a facet never merge as the facet tapers. */
  maxFrac: number;
  glass: number;
  frame: number;
  /** Stable per-window random (0..1). The night-light shader hashes it with
   *  a per-night seed and the building's windowLightChance to decide whether
   *  (and when, within the transition) this window lights tonight — so a
   *  different subset glows every night. */
  litRnd: number;
}

export interface RoomRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Interior wall piece (box, optionally yaw-rotated for polygon perimeter
 *  walls). Doubles 1:1 as a cuboid collider. */
export interface WallBox {
  cx: number;
  cy: number;
  cz: number;
  sx: number;
  sy: number;
  sz: number;
  rotY?: number;
}


/** Deterministic spawn placement for a Building child, in interior-local space. */
export interface ChildSlot {
  position: [number, number, number];
  rotationY: number;
  roomIndex: number;
}

/** One straight-run ramp flight connecting story `story` to story+1. Each
 *  story gap gets its OWN independently placed ramp (spot and orientation
 *  differ per gap), sitting inside a normal room — BSP walls, pillars,
 *  doorways, light panels, and child slots all avoid its footprint. */
export interface RampSpec {
  /** The flight climbs from this story's floor to story+1's. */
  story: number;
  /** Full shaft footprint on `story`'s floor: bottom landing + run + top
   *  landing × lane width. */
  rect: RoomRect;
  /** Slab cutout in story+1's floor — the lane over the run only. */
  hole: RoomRect;
  /** Top landing on story+1, kept clear of walls so you can step off. */
  landing: RoomRect;
  /** Run direction: the flight advances along `axis` in `dir`. */
  axis: "x" | "z";
  dir: 1 | -1;
  /** Coordinates along `axis`: flight bottom (floor of `story`) and top
   *  (floor of story+1). runEnd − runStart is signed by `dir`. */
  runStart: number;
  runEnd: number;
  /** Lane extent across `axis`. */
  lane0: number;
  lane1: number;
}

/** Interior surface color overrides (hex). Unset entries derive from the
 *  building's exterior ground-segment color. */
export interface InteriorColors {
  wall?: number;
  floor?: number;
  ceiling?: number;
  ramp?: number;
}

export interface InteriorPlan {
  /** Bounding-box size of the interior footprint (the perimeter itself is an
   *  N-gon matching the exterior's side count; 4 = plain rect). */
  width: number;
  depth: number;
  ceilingHeight: number;
  /** Resolved interior surface colors (defaults derived from the exterior). */
  colors: { wall: number; floor: number; ceiling: number; ramp: number };
  stories: number;
  /** ceilingHeight + slab thickness — story s floor top sits at s*storyHeight. */
  storyHeight: number;
  /** Room layout PER STORY — each floor rolls its own room count and BSP
   *  splits, so no two floors are identical. For polygon interiors, rooms
   *  fill an inscribed rect block ringed by a corridor. */
  roomsPerStory: RoomRect[][];
  /** Wall boxes PER STORY (story-local y: 0..ceilingHeight): BSP splits and
   *  pillars. The interior PERIMETER has no wall boxes — it is the shell's
   *  inner surface (the shell has real thickness). */
  wallBoxesPerStory: WallBox[][];
  /** One ramp per story gap (ramps[g] climbs story g → g+1); empty for
   *  single-story buildings. */
  ramps: RampSpec[];
  /** Ceiling light panel centers [x, z] per story (each floor rolls its own
   *  grid gaps). */
  lightPanelsPerStory: [number, number][][];
  childSlots: ChildSlot[];
}

export interface BuildingPlan {
  seed: string;
  /** Exterior footprint [width, depth] at ground level. */
  footprint: [number, number];
  height: number;
  /** Exterior walls stay vertical (prismatic) up to this height so door
   *  openings sit in flat wall — lean/taper only starts above it. */
  doorBandTop: number;
  /** Walls extend this far below y=0 so slight terrain slope doesn't show a gap. */
  foundationDepth: number;
  lofts: ExteriorLoft[];
  /** lofts[0..bodyLoftCount-1] are the door band + body segments (the masses
   *  the interior lives inside); the rest are rooftop caps and pipes. */
  bodyLoftCount: number;
  doors: DoorPlan[];
  /** Door leaf color — seeded from the building palette like everything else. */
  doorColor: number;
  /** Fraction (0–1) of this building's windows that light up each night. */
  windowLightChance: number;
  /** Emissive strength of lit window glass (baked into the geometry). */
  windowLightIntensity: number;
  windows: WindowSpec[];
  interior: InteriorPlan;
}

/** Material overrides — future variants plug custom shaders in here. Both
 *  defaults use vertex colors (baked per building: exterior segment colors,
 *  interior wall/floor/ceiling/panel palette), so a custom material should
 *  either respect or deliberately ignore them. */
export interface BuildingMaterials {
  exterior?: THREE.Material;
  interior?: THREE.Material;
}

export enum WINDOW_SHAPE {
  CIRCLE = "circle",
  SQUARE = "square",
}

/** Generation knobs. Anything unset is seeded-random per building. */
export interface BuildingAttributes extends ActorAttributes {
  /** Exterior [width, height, depth] at ground level. */
  exteriorSize?: [number, number, number];
  /** Cross-section side counts to pick from. 4 = boxy slab, 5–8 = faceted
   *  polygon canister. Default [4, 5, 6, 7, 8]. */
  numberOfSides?: number[];
  /** Body colors to pick from (default: a grayscale ramp). */
  palette?: number[];
  /** Occasional-accent colors (default: muted blues/purples/red/rust). */
  accentColors?: number[];
  /** Chance a building's primary color is an accent (default 0.2); a smaller
   *  slice of individual segments also roll an accent. */
  accentChance?: number;
  /** Window shapes to pick from; each building leans ~75% toward one of
   *  them. Default [WINDOW_SHAPE.SQUARE] — CIRCLE is available but opt-in. */
  windowShapes?: WINDOW_SHAPE[];
  /** Total-window-count choices, one picked per building (like
   *  `numberOfSides`). Unset = a seeded fill fraction of the available
   *  window slots; the pick is clamped to the slots that exist. */
  windowCount?: number[];
  /** Window width range [min, max] in world units (default [2.4, 4.4]). */
  windowSize?: [number, number];
  /** Max lean as a fraction of exterior height (default 0.08). */
  maxLean?: number;
  /** Shell height range [min, max] — overrides the floors-derived height
   *  (clamped to fit the floors); the extra mass above the top floor reads
   *  as mechanical levels. Used by tall variants like the skyscraper. */
  shellHeightRange?: [number, number];
  /** Interior floor count (default seeded 1–5). Drives the exterior height. */
  stories?: number;
  /** Rooms-per-floor choices — EACH floor rolls its own count from this
   *  array (like `numberOfSides`), and its own BSP layout, so no two floors
   *  look alike. A plain number pins every floor to that count (layouts
   *  still vary). Default seeded 3–6 per floor. The LARGEST choice drives
   *  the exterior footprint, so every floor's program fits. */
  roomCount?: number | number[];
  doorCount?: 1 | 2;
  /** Door opening [width, height]. Height is clamped below the interior ceiling. */
  doorSize?: [number, number];
  ceilingHeight?: number;
  /** Fraction (0–1) of windows that glow yellowish each night — a different
   *  random subset every night. 0 = never lit. Default 0.2 (Skyscraper
   *  passes 0.8). */
  windowLightChance?: number;
  /** How strongly lit window glass glows (emissive multiplier). Default 1.4. */
  windowLightIntensity?: number;
  /** Interior surface colors — unset entries match the exterior (walls take
   *  the ground-segment color; floor darker, ceiling lighter). */
  interiorColors?: InteriorColors;
}

export interface BuildingProps extends ActorProps<BuildingAttributes> {
  /** Deterministic shape seed. Defaults to the spawn coordinates, so the same
   *  spot regenerates the same building on every load. */
  seed?: string | number;
  materials?: BuildingMaterials;
  children?: React.ReactNode;
}
