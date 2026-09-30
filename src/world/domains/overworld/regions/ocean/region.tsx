import { Material, Region, Skybox } from "../../../../components";
import { LakeBiome } from "./biomes/lake/biome";
import baseShader from "./shaders/base.glsl";
import { OCEAN_REGION } from "./spec";

/** Lakes and the wet, dark shore sand between them, under a hazy marine sky. */
export const OceanRegion = () => (
  <Region spec={OCEAN_REGION} biomes={{ lake: LakeBiome }}>
    <Material shader={baseShader} textures={{ shoretexture: "potato_sack.jpg" }} />
    <Skybox topColor="#5b9bd5" horizonColor="#cfe3ef" bottomColor="#5a6f7d" />
  </Region>
);
