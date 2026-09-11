import type { BuildingAttributes } from "./types";

/**
 * BUILDING VARIANT ATTRIBUTES — the plan-shaping knobs of each building kind,
 * with no React: the descriptors (actor.tsx, skyscraper.tsx) spread these, and
 * the SERVER (physics/buildings.ts) generates the SAME plan from them to build
 * a building's convex hull collider. A variant's shape is defined here once.
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
