import type { ActorSpec } from "../spec";
import type { BuildingAttributes } from "./types";

/**
 * BUILDING SPECS — the plan-shaping attributes of each building kind, with no
 * React: describeActor spreads a spec's `hull` into the descriptor, and the
 * SERVER (physics/buildings.ts) generates the SAME plan from it to build a
 * building's sealed convex hull collider. A variant's shape is defined here
 * once. (Formerly variants.ts.)
 *
 * PLACEMENT constants live here too because the server's domain config
 * (world/domains/glitch-city/config.ts) replicates the flatten pads the
 * terrain levels under every building — from these same numbers.
 */

/** A plain building: every knob at its seeded default. */
export const BUILDING_ATTRS: BuildingAttributes = {};

/** Skyscraper: max floors under a much taller shell (the mass above the top
 *  floor reads as mechanical levels), a gentler lean so tall neighbors don't
 *  collide, and most windows lit at night so towers read as busy from across
 *  the city. */
export const SKYSCRAPER_ATTRS: BuildingAttributes = {
  stories: 6,
  roomCount: [3, 4, 5, 6],
  shellHeightRange: [70, 115],
  maxLean: 0.04,
  windowLightChance: 0.8,
};

export const BUILDING_SPEC: ActorSpec = { id: "building", hull: BUILDING_ATTRS };
export const SKYSCRAPER_SPEC: ActorSpec = { id: "skyscraper", hull: SKYSCRAPER_ATTRS };
/** The grass biomes mount BuildingActor under this id (descriptors dedupe by
 *  id and "building" belongs to the city registration) — same shape. */
export const GRASS_BUILDING_SPEC: ActorSpec = { id: "grass-building", hull: BUILDING_ATTRS };

/** How buildings place — shared with the server's flatten-pad config.
 *  Buildings only place inside block interiors (off roads/sidewalks/ramps),
 *  so density is set high to keep blocks packed — footprint spacing is the
 *  real limiter, and the flatten engine's iterated spacing rounds convert the
 *  oversupply into greedy-level packing. (Halving to 1900 was tried for
 *  flatten-tile cost and REVERTED: combined with single-round spacing it
 *  visibly thinned the city.) `flattenGround`: the city rides the regional
 *  base noise — without the pad, sloped block interiors clip through floors. */
export const BUILDING_PLACEMENT = {
  footprint: 30,
  density: 3800,
  clustering: 0,
  priority: 55,
  roadDistanceRange: [23, 99999] as [number, number],
  flattenGround: true,
};

/** Skyscrapers are restricted to deep block interiors (roadDistanceRange), so
 *  density is raised to keep the skyline as populated as before the road
 *  filter. flattenGround is inherited — a larger, footprint-derived pad. */
export const SKYSCRAPER_PLACEMENT = {
  ...BUILDING_PLACEMENT,
  footprint: 36,
  density: 240,
  priority: 45,
  roadDistanceRange: [28, 99999] as [number, number],
};
