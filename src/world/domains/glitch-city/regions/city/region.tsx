import { Material, Region } from "../../../../components";
import { CityBiome } from "./biomes/city/biome";
import { CityGrassBiome } from "./biomes/grass/biome";
import { CITY_REGION } from "./spec";

/** Urban region: city blocks interleaved with grassland. Biome JSX order =
 *  voronoi order = CITY_REGION.biomes (spec.ts, shared with the server). */
export const CityRegion = () => (
  <Region name={CITY_REGION.name} id={CITY_REGION.id}>
    <Material texture="road.jpg" />
    <CityBiome />
    <CityGrassBiome />
  </Region>
);
