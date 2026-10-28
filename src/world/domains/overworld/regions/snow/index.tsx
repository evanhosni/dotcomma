import { content, Material, Noise, Region, Rivers, Skybox } from "../../../../components";
import { MountainBiome } from "./biomes/mountain";
import { TundraBiome } from "./biomes/tundra";
import baseShader from "./shaders/base.glsl";

/** Low tundra and mountain tops on big, slow relief, under a cold pale sky (a procedural snow
 *  base, no texture asset). Wet: many rivers. */
export const SnowRegion = content(
  <Region id={3} name="snow">
    <Material shader={baseShader} />
    <Noise params={{ type: "perlin", octaves: 3, persistence: 2, lacunarity: 2, exponentiation: 2, height: 600, scale: 4000 }} />
    <Skybox topColor="#8fb3d9" horizonColor="#dbe6f0" bottomColor="#7d8794" />
    <Rivers chance={0.55} />

    <TundraBiome />
    <MountainBiome />
  </Region>,
);
