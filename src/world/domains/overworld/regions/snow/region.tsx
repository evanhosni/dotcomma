import { Material, Region, Skybox } from "../../../../components";
import { MountainBiome } from "./biomes/mountain/biome";
import { TundraBiome } from "./biomes/tundra/biome";
import baseShader from "./shaders/base.glsl";
import { SNOW_REGION } from "./spec";

/** Low tundra and mountain tops on a procedural snow base (no texture asset), under a cold pale sky. */
export const SnowRegion = () => (
  <Region spec={SNOW_REGION} biomes={{ tundra: TundraBiome, mountain: MountainBiome }}>
    <Material shader={baseShader} />
    <Skybox topColor="#8fb3d9" horizonColor="#dbe6f0" bottomColor="#7d8794" />
  </Region>
);
