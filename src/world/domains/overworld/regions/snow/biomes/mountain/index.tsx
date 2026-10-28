import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { Rocks } from "../../../../../../../objects/dressing/rocks";
import { Snow } from "../../../../../../../objects/dressing/snow-drift";
import { RiverBanks } from "../../../../../../../objects/dressing/river-banks";
import { Caves, Rooms } from "../../../../../../underground";
import { Actor, Biome, content, Detail, Dome, Material, Noise } from "../../../../../../components";
import { SNOW_RIVERBED } from "../../riverbed";
import fragmentShader from "./shaders/fragment.glsl";

/**
 * Mountain massifs. The <Dome> carries the height — it rises with the square of the depth inside
 * the mountain, measured across joined cells, so a group of joined cells is ONE mountain whose
 * summit is where the group is deepest (a lone cell rises to a low hill; the deepest groups reach
 * ~600u in, hence `reach`). Three slow octaves ride it, faded to `noiseFloor` at the foot; the two
 * <Detail> layers (bulges and bumps) ride everywhere, the foot included.
 *
 * The WIDE feather stays: the snow base shows for a couple of hundred units at the edge and the
 * rock climbs out of it slowly, in material and height alike (blendWidth governs both). The offset
 * keeps the river rules' relief past RIVER_MAX_RELIEF: a domed biome is ROCK, so rivers climb it
 * (waterfalls, pools, springs).
 */
export const MountainBiome = content(
  <Biome id={7} name="mountain" joinable blendWidth={220}>
    <Material shader={fragmentShader} textures={{ rocktexture: "dirt.png" }} riverbed={SNOW_RIVERBED} />

    <Noise params={{ type: "perlin", octaves: 4, persistence: 0.6, lacunarity: 2, exponentiation: 2, height: 10000, scale: 800 }} offset={70}>
      <Dome height={1500} reach={600} noiseFloor={0.25} />
      {/* ~400/200u bulges, ±45u. */}
      <Detail type="perlin" octaves={2} persistence={1} lacunarity={2} exponentiation={1} height={90} scale={400} />
      {/* ~150–19u bumps, ±22u. */}
      <Detail type="perlin" octaves={4} persistence={1} lacunarity={2} exponentiation={1} height={44} scale={150} />
    </Noise>

    <Caves>
      <Rooms>
        <Actor actor={BEEBLE_SPEC} />
      </Rooms>
    </Caves>

    <Snow />
    <Rocks />
    <RiverBanks />
  </Biome>,
);
