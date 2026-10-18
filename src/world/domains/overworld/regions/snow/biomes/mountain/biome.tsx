import { Dressing } from "../../../../../../../objects/dressing/Dressing";
import { Caves } from "../../../../../../../objects/dressing/underground/Underground";
import { Biome, Material } from "../../../../../../components";
import { SNOW_RIVERBED } from "../../riverbed";
import fragmentShader from "./shaders/fragment.glsl";
import { MOUNTAIN_BIOME } from "./spec";

/** The snow and rocks come from the spec's flags (overworld/domain.tsx mounts those once); the caves are
 *  the biome's own mount, and the spec's `caves` flag is what the terrain bulges their mouths by. */
export const MountainBiome = () => (
  <Biome spec={MOUNTAIN_BIOME}>
    <Material shader={fragmentShader} textures={{ rocktexture: "dirt.png" }} riverbed={SNOW_RIVERBED} />
    <Dressing>
      <Caves />
    </Dressing>
  </Biome>
);
