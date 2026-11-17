import { content, Material, Noise, Pond, Region, Rivers, Skybox } from "../../../../components";
import { DEFAULT_TERRAIN_PARAMS } from "../../../../defaults";
import { POND } from "../../water/spec";
import { CityBiome } from "./biomes/city/CityBiome";
import { GrassBiome } from "./biomes/grass/GrassBiome";
import baseShader from "./shaders/base.glsl";

/** City blocks interleaved with grassland on the classic rolling base noise. The base is plain
 *  grass — what both the city belt and the grass hills fade into at their edges. */
export const CityRegion = content(
  <Region id={1} name="city">
    <Material shader={baseShader} textures={{ grasstexture: "grass.png" }} />
    <Noise params={DEFAULT_TERRAIN_PARAMS.baseNoise} />
    <Skybox />
    <Rivers chance={0.61} />
    <Pond kind={POND} riverEnd={0.5} />

    <CityBiome />
    <GrassBiome />
  </Region>,
);
