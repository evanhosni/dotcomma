import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { GrassField } from "../../../../../../../objects/foliage/grass/GrassField";
import { Biome, Material } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";
import { GRASS_BIOME } from "./spec";

export const GrassBiome = () => (
  <Biome spec={GRASS_BIOME}>
    <Material shader={fragmentShader} textures={{ grasstexture: "grass.png", grassdirttexture: "grass-dirt.png", dirttexture: "dirt.png" }} />
    <Foliage>
      <GrassField
        density={8000000}
        slopeRange={[0, 28]} // terrain shader fades grass texture out past ~0.25 rad, keep blades on the green
        slopeBlend={12}
        roadDistanceRange={[8.5, 99999]} // off the inter-city freeways (normalized street units, curb = 7)
        color="#6fff00"
        width={0.14}
        height={1.3}
        sway={0.5}
      />
    </Foliage>
  </Biome>
);
