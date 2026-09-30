import { Biome, Material } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";
import { LAKE_BIOME } from "./spec";

/** The lake BED — what shows through the water and on the dry shore of a low lake. */
export const LakeBiome = () => (
  <Biome spec={LAKE_BIOME}>
    <Material shader={fragmentShader} textures={{ lakebedtexture: "blue_mud.jpg" }} />
  </Biome>
);
