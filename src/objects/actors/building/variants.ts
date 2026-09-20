import type { BuildingAttributes } from "./types";

// React-free so the SERVER (physics/buildings.ts) generates the same plan for its hull collider.

export const BUILDING_ATTRS: BuildingAttributes = {};

/** Gentler lean so tall neighbors don't collide; most windows lit at night. */
export const SKYSCRAPER_ATTRS: BuildingAttributes = {
  stories: 6,
  roomCount: [3, 4, 5, 6],
  shellHeightRange: [70, 115],
  maxLean: 0.04,
  windowLightChance: 0.8,
};
