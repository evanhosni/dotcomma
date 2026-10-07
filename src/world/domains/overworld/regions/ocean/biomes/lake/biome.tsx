import { Biome, Material } from "../../../../../../components";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { SeaweedField } from "../../../../../../../objects/foliage/seaweed/SeaweedField";
import fragmentShader from "./shaders/fragment.glsl";
import { LAKE_BIOME } from "./spec";

/** The lake BED — sand darkening with depth under the water, seaweed swaying on it. */
export const LakeBiome = () => (
  <Biome spec={LAKE_BIOME}>
    <Material shader={fragmentShader} textures={{ lakesandtexture: "potato_sack.jpg" }} />
    <Foliage>
      <SeaweedField />
    </Foliage>
  </Biome>
);
