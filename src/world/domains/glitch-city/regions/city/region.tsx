import { Material, Region } from "../../../../components";
import { CityBiome } from "./biomes/city/biome";
import { CityGrassBiome } from "./biomes/grass/biome";

export const CityRegion = () => (
  <Region name="city" id={3}>
    <Material texture="road.jpg" />
    <CityBiome />
    <CityGrassBiome />
  </Region>
);
