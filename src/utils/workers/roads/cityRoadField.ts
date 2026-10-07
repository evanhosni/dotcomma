/**
 * The city ROAD FIELD's shared formulas (normalized street units: 0–7 asphalt, 7–8 curb, 8–12
 * sidewalk, 12+ plaza), read by the city terrain, its remnant survey, the off-city freeway (step 5)
 * and the ground under decks. Leaf module: imports nothing from the pipeline but the live config, so
 * any top-level value may read it.
 */

import { smoothstep } from "../../math/_math";
import { domainConfig } from "../computeConfig";

/** The road field and the lane-paint distance (VertexResult.distanceToRoadCenter /
 *  distanceToFreewayCenter) where no road, or no lane paint, is near. */
export const NO_ROAD_DISTANCE = 99999;

/** On the river side of a quay road the field keeps growing to this, well past the plaza band: a
 *  cap AT the plaza band zig-zags the interpolated sand/pavement edge with the terrain vertices.
 *  Buildings stay off the bank through the placement filter's river exclusion. */
export const CITY_QUAY_INNER_CAP = 60;

// The ×(roadWidth/freewayWidth) squash applies up to this normalized value (just past the interior
// band at 12), then the field recovers at the steep slope, so the blocks along an arterial are not
// all setback (no building band).
export const CITY_ARTERIAL_RECOVER_NORM = 12.2;
export const CITY_ARTERIAL_RECOVER_SLOPE = 3;
/** The belt's recovery start (normalized): 9.5 = 19u real, one curb strip past its asphalt. */
export const CITY_BELT_RECOVER_NORM = 9.5;

/** A freeway's field (street units) `real` units from its centerline: squashed into street units,
 *  recovering at CITY_ARTERIAL_RECOVER_SLOPE past `recoverNorm` (max() keeps it continuous). */
export const freewayField = (real: number, recoverNorm: number, freewayToStreetScale: number): number =>
  Math.max(real * freewayToStreetScale, (real - recoverNorm / freewayToStreetScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm);

/** How far the road surface dips under the sidewalk at a road field (street units). */
export const cityCurbDip = (roadDistance: number): number => {
  const city = domainConfig!.cityConfig;
  return city.curbHeight * (1 - smoothstep(city.roadWidth - 2, city.roadWidth, roadDistance));
};
