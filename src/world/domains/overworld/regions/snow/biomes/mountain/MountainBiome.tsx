import { PondSteam } from "../../../../../../../objects/particles/pond-steam/PondSteam";
import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { Rocks } from "../../../../../../../objects/dressing/rocks/Rocks";
import { Snow } from "../../../../../../../objects/dressing/snow-drift/Snow";
import { Caves } from "../../../../../../underground/Caves";
import { Rooms } from "../../../../../../underground/Rooms";
import { Actor, Banks, Biome, content, Detail, Dome, Material, Noise, Pond, Rivers } from "../../../../../../components";
import { HOT_SPRING, POND } from "../../../../water/spec";
import { SNOW_RIVERBED } from "../../material";
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
 * keeps the river rules' relief past RIVER_MAX_RELIEF: a river carves a gorge through the mountain
 * or ends at its foot. Its rivers (its region's chance: the <Rivers> names none) run between bumpy banks;
 * half their ends hold a pond — a plain one or a hot spring, one in four each (its own POND mount replaces
 * the snow's) — half their calm slots a hot spring, and half the gaps a massif leaves between two of them
 * are climbed to one on top (generation/water/rivers/ponds/index.ts — `summit={0}` turns the climbs off). Its ponds are at least
 * 75u across the waterline: the massif is cut back round them (a 45u summit pond sat in a notch).
 */
export const MountainBiome = content(
  <Biome id={7} name="mountain" joinable blendWidth={220} pondMinRadius={75} additionalHeight={200}>
    {/* Its riverbed yields to the rock on steep banks: a mountainside rising out of a river keeps its rock. */}
    <Material shader={fragmentShader} textures={{ rocktexture: "dirt.png" }} riverbed={{ ...SNOW_RIVERBED, yieldSlope: [30, 40] }} />

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
    <Rivers>
      <Banks />
    </Rivers>
    <Pond kind={POND} riverEnd={0.25}>
      <Banks />
    </Pond>
    <Pond kind={HOT_SPRING} riverEnd={0.25} midRiver={0.5} summit={0.5}>
      <Banks />
      <PondSteam />
    </Pond>
  </Biome>,
);
