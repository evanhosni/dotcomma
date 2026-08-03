import { Material, Region } from "../../world/components";
import { CityBiome } from "./biomes/city/CityBiome";
import { CityGrassBiome } from "./biomes/grass/CityGrassBiome";

/** Urban region: city blocks interleaved with grassland. */
export const CityRegion = () => (
  <Region name="city" id={3}>
    <Material texture="road.jpg" />
    <CityBiome />
    <CityGrassBiome />
  </Region>
);
