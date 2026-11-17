import type { DomainConfig } from "../../types";

export interface CityDistrict {
  key: string;
  r: number; // row / segment indices (for the wiggly edge lookups)
  m: number;
  cos: number; // rotation: a seeded multiple of 15°
  sin: number;
  px: number; // rotation pivot (district center, world)
  pz: number;
  minX: number; // district rect BASELINE (world; actual edges wiggle ±CITY_WIGGLE_AMP)
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CityCell {
  /** Block index in [0, blockCount) for squares (same labels merge; a REMNANT carries a neighbor's, or
   *  CITY_REMNANT_LABEL); a unique id (≥1000) for triangle/circle cells so roads always ring them. */
  label: number;
  shape: number;
  /** Whether an edge road reaches into the cell (not every sample of it is land). */
  edged: boolean;
}

/** A cell surveyed: its plain block index, its super-cell's shape, and what the edge roads leave of
 *  it — its buildable core samples, its LAND samples, and those on each side (W, E, S, N: the half
 *  toward that neighbor, middle row/column included). A sample's edge field is the nearest of the belt
 *  (outside the city: no land), the district's arterials and a river's quay road (on its river side:
 *  no land), by the road field's own formulas — from the walls, the arterial curves and the raw river
 *  pieces alone: a cell is built mid-vertex, where no terrain may run. */
export interface CellSurvey {
  plain: number;
  shape: number;
  core: number;
  land: number;
  sides: [number, number, number, number];
}

// Nested numeric maps: a flat string key allocated ~10 strings per city vertex on HITS.
export interface CityCellStore {
  count: number;
  districts: Map<string, Map<number, Map<number, CityCell>>>;
}

export type CityConfig = DomainConfig["cityConfig"];

export interface CityTerrain {
  roadDistance: number; // to the nearest road centerline, in street units
  relativeElevation: number; // relative to the regional base (computeVertexData adds it back)
  /** The curb dip relativeElevation includes: a shore lift is applied UNDER it (computeVertexData). */
  curbDip: number;
  freewayDistance: number; // real units to the nearest freeway centerline (lane paint)
  freewayAlong: number; // dash-phase coordinate along that freeway
  freewayReal: number; // real units to the nearest arterial or belt centerline, junction zones included
  /** The lane paint here is the WATERFRONT's (the belt carried along the water): it runs along the
   *  river, so it never "ends" at it (computeVertexData's lane-end rule). */
  paintOnWaterfront: boolean;
  /** Whether an edge road reaches into the vertex's cell or one around it: only there can it pinch off
   *  a block island (a cell no edge road reaches holds its whole core, a building's band). */
  nearEdge: boolean;
}
