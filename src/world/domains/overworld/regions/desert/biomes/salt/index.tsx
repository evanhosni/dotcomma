import { Biome, content, Noise } from "../../../../../../components";

/** Salt flats: a slightly sunken, almost perfectly level pan (tiny ripples only), fading up into
 *  the sand around it over a wide feather. No <Material>: it is the desert's bare base sand. */
export const SaltBiome = content(
  <Biome id={5} name="salt" joinable blendWidth={200}>
    <Noise params={{ type: "perlin", octaves: 2, persistence: 1, lacunarity: 2, exponentiation: 1, height: 6, scale: 300 }} offset={-8} />
  </Biome>,
);
