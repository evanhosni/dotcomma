import { Biome, content, Material, Noise } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";

/** Salt flats: a slightly sunken, almost perfectly level pan (tiny ripples only), fading up into
 *  the sand around it over a wide feather. */
export const SaltBiome = content(
  <Biome id={5} name="salt" joinable blendWidth={200}>
    <Material shader={fragmentShader} textures={{ salttexture: "sidewalk.png" }} />
    <Noise params={{ type: "perlin", octaves: 2, persistence: 1, lacunarity: 2, exponentiation: 1, height: 6, scale: 300 }} offset={-8} />
  </Biome>,
);
