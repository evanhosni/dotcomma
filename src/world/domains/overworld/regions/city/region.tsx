import { Material, Region, Skybox } from "../../../../components";
import { CityBiome } from "./biomes/city/biome";
import { GrassBiome } from "./biomes/grass/biome";
import baseShader from "./shaders/base.glsl";
import { CITY_REGION } from "./spec";

/** The base is plain grass — what both the city belt and the grass hills fade into. */
export const CityRegion = () => (
  <Region spec={CITY_REGION} biomes={{ city: CityBiome, grass: GrassBiome }}>
    <Material shader={baseShader} textures={{ grasstexture: "grass.png" }} />
    <Skybox topColor="#4a90d9" horizonColor="#87ceeb" bottomColor="#666666" />
  </Region>
);
