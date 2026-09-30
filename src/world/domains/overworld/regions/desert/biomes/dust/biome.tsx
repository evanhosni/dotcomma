import { Biome, Material } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";
import { DUST_BIOME } from "./spec";

export const DustBiome = () => (
  <Biome spec={DUST_BIOME}>
    <Material shader={fragmentShader} textures={{ sandtexture: "potato_sack.jpg" }} />
  </Biome>
);
