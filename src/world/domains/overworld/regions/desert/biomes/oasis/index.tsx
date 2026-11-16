import { Biome, content, Material, Noise, Pond, Rivers } from "../../../../../../components";
import { SPRING } from "../../../../water/spec";
import fragmentShader from "./shaders/fragment.glsl";

/** Dust's dunes (the same <Noise> literal: the relief joins across a dust|oasis wall) in paler sand, holding a
 *  rare, blobby spring. No river runs here. A quarter of a sibling's share of the desert's roll. */
export const OasisBiome = content(
  <Biome id={9} name="oasis" joinable weight={0.25}>
    <Material shader={fragmentShader} textures={{ sandtexture: "potato_sack.jpg" }} />
    <Noise params={{ type: "perlin", octaves: 3, persistence: 1, lacunarity: 1, exponentiation: 1, height: 150, scale: 200 }} absNeg offset={50} />
    {/* DRY: no river is built in it (a river reaching its wall ends there in a pond). */}
    <Rivers chance={0} />
    <Pond kind={SPRING} standalone={0.2} />
  </Biome>,
);
