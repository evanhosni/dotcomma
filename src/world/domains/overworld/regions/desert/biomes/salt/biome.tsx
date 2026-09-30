import { Biome, Material } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";
import { SALT_BIOME } from "./spec";

export const SaltBiome = () => (
  <Biome spec={SALT_BIOME}>
    <Material shader={fragmentShader} textures={{ salttexture: "sidewalk.png" }} />
  </Biome>
);
