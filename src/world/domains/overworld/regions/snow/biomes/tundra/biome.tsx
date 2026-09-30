import { Biome, Material } from "../../../../../../components";
import { SNOW_RIVERBED } from "../../riverbed";
import fragmentShader from "./shaders/fragment.glsl";
import { TUNDRA_BIOME } from "./spec";

export const TundraBiome = () => (
  <Biome spec={TUNDRA_BIOME}>
    <Material shader={fragmentShader} textures={{ tundrascrubtexture: "grass-dirt.png" }} riverbed={SNOW_RIVERBED} />
  </Biome>
);
