import { HOUSE_SPEC } from "../../../../../../../objects/actors/building/spec";
import { BEEBLE_SPEC } from "../../../../../../../objects/actors/beeble/spec";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Actor, Biome, content, Material, Noise, Pond } from "../../../../../../components";
import { POND } from "../../../../water/spec";
import fragmentShader from "./shaders/fragment.glsl";

/** Per km² of the ponds' shallows (where they stand: the actor's zone): about three a pond. */
const BEEBLES_PER_KM2 = 3000;

/** Rolling perlin hills with houses scattered on flatten pads, and ponds with beebles wading in them. */
export const GrassBiome = content(
  <Biome id={3} name="grass" joinable>
    <Material shader={fragmentShader} textures={{ grasstexture: "grass.png", grassdirttexture: "grass-dirt.png", dirttexture: "dirt.png" }} />
    <Noise params={{ type: "perlin", octaves: 3, persistence: 1, lacunarity: 1, exponentiation: 1, height: 100, scale: 100 }} />

    <Pond kind={POND} riverEnd={0.5} midRiver={0.5} standalone={0.5}>
      <Actor actor={BEEBLE_SPEC} density={BEEBLES_PER_KM2} />
    </Pond>

    <GrassField
      density={8000000}
      slopeRange={[0, 28]} // the terrain shader fades the grass texture out past ~0.25 rad: keep blades on the green
      slopeBlend={12}
      roadDistanceRange={[8.5, 99999]} // off the inter-city freeways (normalized street units, curb = 7)
      color="#6fff00"
      width={0.14}
      height={1.3}
      sway={0.5}
    />

    <Actor actor={HOUSE_SPEC} density={30} />
  </Biome>,
);
