import { Biome, content, Material, Noise } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";

/** Folded perlin dunes, raised 50u. */
export const DustBiome = content(
  <Biome id={2} name="dust" joinable>
    <Material shader={fragmentShader} textures={{ sandtexture: "potato_sack.jpg" }} />
    <Noise params={{ type: "perlin", octaves: 3, persistence: 1, lacunarity: 1, exponentiation: 1, height: 150, scale: 200 }} absNeg offset={50} />
  </Biome>,
);
