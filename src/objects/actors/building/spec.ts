import type { ActorSpec } from "../spec";
import type { BuildingAttributes } from "./types";

// The server (physics/buildings.ts) generates the SAME plan from a spec's `hull` to
// build the sealed collider, and its domain config replicates the flatten pads
// from the PLACEMENT constants — a building's shape and placement are defined here once.

export const BUILDING_ATTRS: BuildingAttributes = {};

/** Max floors under a much taller shell (mechanical levels), a gentler lean so tall
 *  neighbors don't collide, most windows lit so towers read as busy from afar. */
export const SKYSCRAPER_ATTRS: BuildingAttributes = {
  stories: 6,
  roomCount: [3, 4, 5, 6],
  shellHeightRange: [70, 115],
  maxLean: 0.04,
  windowLightChance: 0.8,
};

export const BUILDING_SPEC: ActorSpec = { id: "building", hull: BUILDING_ATTRS };
export const SKYSCRAPER_SPEC: ActorSpec = { id: "skyscraper", hull: SKYSCRAPER_ATTRS };
/** The grass biomes mount BuildingActor under this id (descriptors dedupe by id; "building" is the city's). */
export const GRASS_BUILDING_SPEC: ActorSpec = { id: "grass-building", hull: BUILDING_ATTRS };

/** Buildings only place inside block interiors, so density is high to keep blocks
 *  packed — footprint spacing is the real limiter (1900 was tried and REVERTED: it
 *  visibly thinned the city). flattenGround: sloped block interiors otherwise clip floors. */
export const BUILDING_PLACEMENT = {
  footprint: 30,
  density: 3800,
  clustering: 0,
  priority: 55,
  roadDistanceRange: [23, 99999] as [number, number],
  flattenGround: true,
};

/** Deep block interiors only, so density is raised to keep the skyline populated. */
export const SKYSCRAPER_PLACEMENT = {
  ...BUILDING_PLACEMENT,
  footprint: 36,
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999] as [number, number],
};
