import { BUILDING_PLACEMENT, SKYSCRAPER_PLACEMENT } from "../../../objects/actors/building/spec";
import { DEFAULT_TERRAIN_PARAMS } from "../../defaults";
import { buildDomainConfigFromSpecs } from "../domainConfig";
import { CITY_BIOME } from "./regions/city/biomes/city/spec";
import { CITY_GRASS_BIOME } from "./regions/city/biomes/grass/spec";
import { CITY_REGION } from "./regions/city/spec";
import { DESERT_REGION } from "./regions/desert/spec";

/**
 * The Three-free description of glitch-city the SERVER's physics runs on, built
 * from the same spec files the JSX mounts. What the JSX MOUNTS is still written by
 * hand here — region ORDER and the flatten-pad actors with their mount overrides —
 * and the <Domain> commit console.errors the differing keys in dev when they drift.
 */

export const GLITCH_CITY_SEED = "123";

export const GLITCH_CITY_CONFIG = buildDomainConfigFromSpecs({
  params: { ...DEFAULT_TERRAIN_PARAMS, seed: GLITCH_CITY_SEED },
  // JSX order = voronoi order.
  regions: [CITY_REGION, DESERT_REGION],
  flatten: [
    { ...BUILDING_PLACEMENT, id: "building", biomeIds: [CITY_BIOME.id] },
    { ...SKYSCRAPER_PLACEMENT, id: "skyscraper", biomeIds: [CITY_BIOME.id] },
    { ...BUILDING_PLACEMENT, id: "grass-building", biomeIds: [CITY_GRASS_BIOME.id], density: 25 },
  ],
});
