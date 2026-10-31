import { content, Material, Noise, Region, Rivers, Skybox } from "../../../../components";
import { LakeBiome } from "./biomes/lake";
import baseShader from "./shaders/base.glsl";

/** Lakes and the wet, dark shore sand between them, under a hazy marine sky. A nearly flat base,
 *  so every lake's level and shore agree, and rivers feeding in from every side. */
export const OceanRegion = content(
  <Region id={4} name="ocean">
    <Material shader={baseShader} textures={{ shoretexture: "potato_sack.jpg" }} />
    <Noise params={{ type: "perlin", octaves: 2, persistence: 1, lacunarity: 2, exponentiation: 1, height: 24, scale: 3000 }} />
    <Skybox topColor="#5b9bd5" horizonColor="#cfe3ef" bottomColor="#5a6f7d" />
    <Rivers chance={0.6} />

    <LakeBiome />
  </Region>,
);
