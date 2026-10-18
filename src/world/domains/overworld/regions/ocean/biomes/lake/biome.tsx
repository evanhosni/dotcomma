import { Biome, Material } from "../../../../../../components";
import { Foliage } from "../../../../../../../objects/foliage/Foliage";
import { SeaweedField } from "../../../../../../../objects/foliage/seaweed/SeaweedField";
import fragmentShader from "./shaders/fragment.glsl";
import { LAKE_BIOME } from "./spec";

/** The lake BED — sand darkening with depth under the water, seaweed swaying on it (the bubbles rising off
 *  every water biome's floor are the domain's one <LakeBubbles/> mount). */
export const LakeBiome = () => (
  <Biome spec={LAKE_BIOME}>
    {/* The river bed under the lake is the lake floor's own sand: a channel entering the basin wears the same
        texture as the floor around it (both under the one bed shade), so the two meet without a seam. */}
    <Material shader={fragmentShader} textures={{ lakesandtexture: "potato_sack.jpg" }} riverbed={{ texture: "potato_sack.jpg" }} />
    <Foliage>
      <SeaweedField />
    </Foliage>
  </Biome>
);
