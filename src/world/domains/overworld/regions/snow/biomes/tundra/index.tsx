import { Rocks } from "../../../../../../../objects/dressing/rocks";
import { Snow } from "../../../../../../../objects/dressing/snow-drift";
import { Biome, content, Material, Noise } from "../../../../../../components";
import { SNOW_RIVERBED } from "../../riverbed";
import fragmentShader from "./shaders/fragment.glsl";

/** Snowy tundra: low frozen ground with shallow hummocks; a modest feather into the snow base.
 *  Snow lies on it and a sparse field of small rocks is strewn over it. */
export const TundraBiome = content(
  <Biome id={6} name="tundra" joinable blendWidth={120}>
    <Material shader={fragmentShader} textures={{ tundrascrubtexture: "grass-dirt.png" }} riverbed={SNOW_RIVERBED} />
    <Noise params={{ type: "perlin", octaves: 3, persistence: 1, lacunarity: 2, exponentiation: 1, height: 40, scale: 260 }} />

    <Snow />
    <Rocks density={110} footprint={6} sizeMin={0.4} sizeMax={3} flatKeep={0.3} startDeg={8} fullDeg={25} />
  </Biome>,
);
