import type { ActorAttributes } from "../../types";
import type { ActorSpec } from "../spec";
import type { BuildingAttributes } from "./types";

// The server (physics/buildings.ts) generates the SAME plan from a spec's `hull` to build the
// sealed collider, and its domain config derives the flatten pads from the placement here — a
// building kind's shape and placement are defined once, in its spec.

/** Every generation attribute (BuildingAttributes minus the shared actor ones): what Building.tsx
 *  generates its plan from, and the keys a mount must not override (spec.ts `mountOverridesOf`). The
 *  Record makes a new attribute a compile error until it is listed. */
type BuildingHullKey = Exclude<keyof BuildingAttributes, keyof ActorAttributes>;
const HULL_KEY_SET: Record<BuildingHullKey, true> = {
  exteriorSize: true,
  numberOfSides: true,
  palette: true,
  accentColors: true,
  accentChance: true,
  windowShapes: true,
  windowCount: true,
  windowSize: true,
  maxLean: true,
  shellHeightRange: true,
  stories: true,
  roomCount: true,
  doorCount: true,
  doorSize: true,
  ceilingHeight: true,
  windowLightChance: true,
  windowLightIntensity: true,
  interiorColors: true,
};
export const BUILDING_HULL_KEYS = Object.keys(HULL_KEY_SET) as readonly BuildingHullKey[];

/** A building's default seed: its spawn position, rounded — so the client (Building.tsx) and the
 *  server (physics/buildings.ts) generate the same plan for the same spot. */
export const buildingSeedAt = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

export const BUILDING_ATTRS: BuildingAttributes = {};

/** Farthest ray distance (eye → leaf) a door can be hovered/clicked from. The server measures a door
 *  click from the DOOR's position in the seeded plan, plus INTERACT_REACH_SLACK (a building's origin is
 *  its center, and facade doors sit 9–16u from it — measured over 200 seeds). */
export const DOOR_INTERACT_REACH = 6;

/** Max floors under a much taller shell (mechanical levels), a gentler lean so tall
 *  neighbors don't collide, most windows lit so towers read as busy from afar. */
const SKYSCRAPER_ATTRS: BuildingAttributes = {
  stories: 6,
  roomCount: [3, 4, 5, 6],
  shellHeightRange: [70, 115],
  maxLean: 0.04,
  windowLightChance: 0.8,
};

/** Buildings only place inside block interiors, so density is high to keep blocks
 *  packed — footprint spacing is the real limiter (half this density visibly thins the
 *  city). flattenGround: sloped block interiors otherwise clip floors. */
export const BUILDING_SPEC: ActorSpec = {
  id: "building",
  component: "building",
  renderDistance: 625,
  frustumPadding: 3.25,
  footprint: 30,
  density: 3800,
  clustering: 0,
  priority: 55,
  roadDistanceRange: [23, 99999],
  flattenGround: true,
  hull: BUILDING_ATTRS,
};

/** Deep block interiors only, so density is raised to keep the skyline populated. */
export const SKYSCRAPER_SPEC: ActorSpec = {
  ...BUILDING_SPEC,
  id: "skyscraper",
  footprint: 36,
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999],
  hull: SKYSCRAPER_ATTRS,
};

/** The grassland's scattered buildings: the city building's kind under its own id (descriptors
 *  dedupe by id, and "building" is the city's); the grass biome's mount sets its density. */
export const GRASS_BUILDING_SPEC: ActorSpec = { ...BUILDING_SPEC, id: "grass-building" };
