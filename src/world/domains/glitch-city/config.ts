import { BUILDING_PLACEMENT, SKYSCRAPER_PLACEMENT } from "../../../objects/actors/building/spec";
import { DEFAULT_TERRAIN_PARAMS } from "../../defaults";
import { buildDomainConfigFromSpecs } from "../domainConfig";
import { CITY_BIOME } from "./regions/city/biomes/city/spec";
import { CITY_GRASS_BIOME } from "./regions/city/biomes/grass/spec";
import { CITY_REGION } from "./regions/city/spec";
import { DESERT_REGION } from "./regions/desert/spec";

/**
 * glitch-city's SHARED DOMAIN CONFIG — the Three-free, React-free description
 * of the world that the SERVER's physics runs on (server/src/game/physics/
 * physicsWorld.ts), assembled from the same spec files the JSX mounts:
 *
 *   domain.tsx            <Terrain seed={GLITCH_CITY_SEED}/>    (other params = defaults)
 *   regions/<region>/spec.ts        region id/name + biome specs in JSX order
 *   .../biomes/<biome>/spec.ts      biome flags + noise (what <Biome spec>/<Terrain noise> read)
 *   building/spec.ts      BUILDING_PLACEMENT / SKYSCRAPER_PLACEMENT (the flatten pads)
 *
 * The one thing still written by hand is what the JSX MOUNTS: which regions
 * (order!) and which flatten-pad actors with which per-mount overrides
 * (`<BuildingActor id="grass-building" biomeIds={[…]} density={25}/>`). The
 * <Domain> commit compares its own config against this object in dev and
 * console.errors the differing keys — so mount something new here too, or
 * the server stands on different ground than the client.
 */

export const GLITCH_CITY_SEED = "123";

export const GLITCH_CITY_CONFIG = buildDomainConfigFromSpecs({
  params: { ...DEFAULT_TERRAIN_PARAMS, seed: GLITCH_CITY_SEED },
  // JSX order = voronoi order (domain.tsx mounts <CityRegion/> then <DesertRegion/>).
  regions: [CITY_REGION, DESERT_REGION],
  // Flatten-pad actors in JSX registration order, with their mount overrides.
  flatten: [
    { ...BUILDING_PLACEMENT, id: "building", biomeIds: [CITY_BIOME.id] },
    { ...SKYSCRAPER_PLACEMENT, id: "skyscraper", biomeIds: [CITY_BIOME.id] },
    { ...BUILDING_PLACEMENT, id: "grass-building", biomeIds: [CITY_GRASS_BIOME.id], density: 25 },
  ],
});
