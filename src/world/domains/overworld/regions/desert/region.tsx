import { Material, Region, Skybox } from "../../../../components";
import { DustBiome } from "./biomes/dust/biome";
import { SaltBiome } from "./biomes/salt/biome";
import baseShader from "./shaders/base.glsl";
import { DESERT_REGION } from "./spec";

/** Dust dunes and salt flats on bare sand, under a dusty ochre sky. */
export const DesertRegion = () => (
  <Region spec={DESERT_REGION} biomes={{ dust: DustBiome, salt: SaltBiome }}>
    <Material shader={baseShader} textures={{ sandtexture: "potato_sack.jpg" }} />
    <Skybox topColor="#c98a4b" horizonColor="#f0c890" bottomColor="#6b5a4a" />
  </Region>
);
