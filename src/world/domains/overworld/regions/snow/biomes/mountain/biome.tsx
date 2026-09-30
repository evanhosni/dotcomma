import { Biome, Material } from "../../../../../../components";
import { SNOW_RIVERBED } from "../../riverbed";
import fragmentShader from "./shaders/fragment.glsl";
import { MOUNTAIN_BIOME } from "./spec";

export const MountainBiome = () => (
  <Biome spec={MOUNTAIN_BIOME}>
    <Material shader={fragmentShader} textures={{ rocktexture: "dirt.png" }} riverbed={SNOW_RIVERBED} />
  </Biome>
);
