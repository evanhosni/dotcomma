/**
 * The city ROAD FIELD's shared formulas (normalized street units: 0–7 asphalt, 7–8 curb, 8–12
 * sidewalk, 12+ plaza), read by the city terrain, its remnant survey, the off-city freeway (step 5)
 * and the ground under decks. Leaf module: imports nothing from the pipeline but the live config, so
 * any top-level value may read it.
 */
import { smoothstep } from "../../utils/math";
import { domainConfig } from "../store";
import { CITY_ARTERIAL_RECOVER_SLOPE } from "./constants";

/** A freeway's field (street units) `real` units from its centerline: squashed into street units,
 *  recovering at CITY_ARTERIAL_RECOVER_SLOPE past `recoverNorm` (max() keeps it continuous). */
export const freewayField = (real: number, recoverNorm: number, freewayToStreetScale: number): number =>
  Math.max(real * freewayToStreetScale, (real - recoverNorm / freewayToStreetScale) * CITY_ARTERIAL_RECOVER_SLOPE + recoverNorm);

/** How far the road surface dips under the sidewalk at a road field (street units). */
export const cityCurbDip = (roadDistance: number): number => {
  const city = domainConfig!.cityConfig;
  return city.curbHeight * (1 - smoothstep(city.roadWidth - 2, city.roadWidth, roadDistance));
};
