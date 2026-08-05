import * as THREE from "three";
import { SpawnedObjectProps } from "../../objects/spawning/types";

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

/** Exit-door placement on the interior perimeter, in interior-local space.
 *  +z of the portal (yaw) faces INTO the interior (see the pair-transform
 *  convention in buildingAssets). */
export interface ExitDoor {
  position: [number, number, number];
  yaw: number;
  width: number;
  height: number;
}

/** Deterministic spawn placement for a Building child, in interior-local space. */
export interface ChildSlot {
  position: [number, number, number];
  rotationY: number;
  roomIndex: number;
}

/** Stacked straight-run ramp shaft, identical on every story: a ramp lane
 *  (the inclined flights + the slab holes above them) beside a solid walkway
 *  lane used to get back to the next flight's start. */
export interface RampSpec {
  /** Full ramp-shaft rect (excluded from rooms, lights, and child slots). */
  room: RoomRect;
  /** Slab cutout — the ramp lane over the run, on every inter-story slab. */
  hole: RoomRect;
  /** Flights ascend +x from runStart (floor) to runEnd (next floor). */
  runStart: number;
  runEnd: number;
  laneZ0: number;
  laneZ1: number;
}

export interface InteriorPlan {
  /** Bounding-box size of the interior footprint (the perimeter itself is an
   *  N-gon matching the exterior's side count; 4 = plain rect). */
  width: number;
  depth: number;
  ceilingHeight: number;
  stories: number;
  /** ceilingHeight + slab thickness — story s floor top sits at s*storyHeight. */
  storyHeight: number;
  /** Room layout of one story (identical on every story). For polygon
   *  interiors, rooms fill an inscribed rect block ringed by a corridor. */
  rooms: RoomRect[];
  /** Walls replicated on every story: BSP splits, shaft walls, block
   *  boundary walls, pillars. */
  wallBoxesCommon: WallBox[];
  /** Ground-story perimeter (carved by the exit doors). */
  perimeterGround: WallBox[];
  /** Upper-story perimeter (solid). */
  perimeterUpper: WallBox[];
  ramp: RampSpec | null;
  exitDoors: ExitDoor[];
  /** Ceiling light panel centers [x, z] (replicated per story). */
  lightPanels: [number, number][];
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
  doors: DoorPlan[];
  windows: WindowSpec[];
  interior: InteriorPlan;
}

/** Material overrides — future variants plug custom shaders in here. The
 *  default exterior material uses vertex colors (baked per building), so a
 *  custom exterior material should either respect or deliberately ignore them. */
export interface BuildingMaterials {
  exterior?: THREE.Material;
  wall?: THREE.Material;
  floor?: THREE.Material;
  ceiling?: THREE.Material;
}

export enum WINDOW_SHAPE {
  CIRCLE = "circle",
  SQUARE = "square",
}

/** Generation knobs. Anything unset is seeded-random per building. */
export interface BuildingOptions {
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
  heightRange?: [number, number];
  /** Interior floor count (default seeded 1–5). Drives the exterior height. */
  stories?: number;
  /** Rooms per floor (default seeded 3–6). Together with `stories` this
   *  drives the exterior footprint, so the shell realistically reflects the
   *  interior. */
  roomCount?: number;
  doorCount?: 1 | 2;
  /** Door opening [width, height]. Height is clamped below the interior ceiling. */
  doorSize?: [number, number];
  ceilingHeight?: number;
  /** Interior footprint = exterior footprint × this (default 1 — interiors
   *  match their shell; larger values make the inside bigger than the
   *  outside, portals hide the lie). Ignored when sizes are derived from
   *  rooms/stories; applied when `exteriorSize` is given. */
  interiorScale?: number;
}

export interface BuildingProps extends SpawnedObjectProps, BuildingOptions {
  /** Deterministic shape seed. Defaults to the spawn coordinates, so the same
   *  spot regenerates the same building on every load. */
  seed?: string | number;
  materials?: BuildingMaterials;
  activationDistance?: number;
  /** Backrooms-style emissive ceiling panels (default on). */
  ceilingLights?: boolean;
  children?: React.ReactNode;
}
