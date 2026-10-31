/** What the ground at a point IS, in one word, for the dev overlay and anything that keys on it later
 *  (footstep sounds, particles). Main-thread rate (the place poll), never per vertex. The terrain's own
 *  texture mix (grass vs dirt on a slope) is decided per pixel by each biome's shader and is not known
 *  here: a point that is none of the shared surfaces below reads as its biome's name. */

import { roadBearingBiomeIds } from "./biomeFlags";
import { domainConfig } from "./computeConfig";
import { computeVertexData, surfaceModifiersAt } from "./vertexCompute";

/** Snow at least this deep reads as snow (thinner is a dusting over the biome's own ground). */
const SNOW_GROUND_DEPTH = 0.05;
/** The city shader's bands in street units past the road's half width: curb + sidewalk (city fragment.glsl). */
const SIDEWALK_BAND = 5;

export const groundAt = (x: number, z: number): string => {
  if (!domainConfig) throw new Error("vertexCompute not initialized");
  const vd = computeVertexData(x, z);
  if (vd.waterHeight > vd.height) return "water";
  if (surfaceModifiersAt(x, z).snowDepth >= SNOW_GROUND_DEPTH) return "snow";
  const { cityConfig, river } = domainConfig;
  if (vd.distanceToFreewayCenter <= cityConfig.freewayWidth) return "freeway";
  if (roadBearingBiomeIds().includes(vd.biomeId)) {
    if (vd.distanceToRoadCenter <= cityConfig.roadWidth) return "road";
    if (vd.distanceToRoadCenter <= cityConfig.roadWidth + SIDEWALK_BAND) return "sidewalk";
  }
  if (vd.riverBedDistance < river.halfWidth + river.bank) return "riverbed";
  for (const region of domainConfig.regions) for (const biome of region.biomes) if (biome.id === vd.biomeId) return biome.name;
  return "?";
};
