import { content, Material, Noise, Region, Rivers, Skybox } from "../../../../components";
import { DustBiome } from "./biomes/dust";
import { SaltBiome } from "./biomes/salt";
import baseShader from "./shaders/base.glsl";

/** Dust dunes and salt flats on bare sand, under a dusty ochre sky. Its OWN base noise — broad
 *  simplex swells — so crossing in reads as the land itself changing. Few rivers: a desert is dry. */
export const DesertRegion = content(
  <Region id={2} name="desert">
    <Material shader={baseShader} textures={{ sandtexture: "potato_sack.jpg" }} />
    <Noise params={{ type: "simplex", octaves: 2, persistence: 1.2, lacunarity: 2, exponentiation: 1, height: 260, scale: 1800 }} />
    <Skybox topColor="#c98a4b" horizonColor="#f0c890" bottomColor="#6b5a4a" />
    <Rivers chance={0.15} />

    <DustBiome />
    <SaltBiome />
  </Region>,
);
