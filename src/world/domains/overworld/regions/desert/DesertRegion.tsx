import { content, Material, Noise, Pond, Region, Rivers, Skybox } from "../../../../components";
import { POND } from "../../water/spec";
import { DustBiome } from "./biomes/dust/DustBiome";
import { OasisBiome } from "./biomes/oasis/OasisBiome";
import { SaltBiome } from "./biomes/salt/SaltBiome";
import baseShader from "./shaders/base.glsl";

/** Dust dunes (here and there an oasis) and salt flats on bare sand, under a dusty ochre sky. Its OWN base noise — broad
 *  simplex swells — so crossing in reads as the land itself changing. Few rivers: a desert is dry (0.26 was
 *  too many for Evan; most of what remains crosses in from the neighbouring regions), and most of them
 *  simply end: a pond at only one end in seven (Evan: "somewhat low"). Barely risen off its water (5u, not the
 *  overworld's 20), over a blend 5× the default, so the lift eases far into its neighbours. */
export const DesertRegion = content(
  <Region id={2} name="desert" additionalHeight={5} additionalHeightBlend={2500}>
    <Material shader={baseShader} textures={{ sandtexture: "potato_sack.jpg" }} />
    <Noise params={{ type: "simplex", octaves: 2, persistence: 1.2, lacunarity: 2, exponentiation: 1, height: 260, scale: 1800 }} />
    <Skybox topColor="#c98a4b" horizonColor="#f0c890" bottomColor="#6b5a4a" />
    <Rivers chance={0.052} />
    <Pond kind={POND} riverEnd={0.15} />

    <DustBiome />
    <OasisBiome />
    <SaltBiome />
  </Region>,
);
