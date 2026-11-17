import { WaterBubbles } from "../../../../../../../objects/particles/water-bubbles/WaterBubbles";
import { SeaweedField } from "../../../../../../../objects/foliage/seaweed/SeaweedField";
import { Biome, content, Lake, Material } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";

/** A lake: the water stands at a LEVEL (the region base at the cell's site, blended across
 *  neighbouring water cells), and the terrain is defined relative to it — the shore above it at the
 *  wall, descending over `blendWidth` to `depth` below it. A river reaching it runs on into the
 *  basin. */
export const LakeBiome = content(
  <Biome id={8} name="lake" joinable blendWidth={90}>
    {/* The river bed under the lake is the lake floor's own sand: a channel entering the basin wears
        the same texture as the floor around it (both under the one bed shade), so the two meet without a seam. */}
    <Material shader={fragmentShader} textures={{ lakesandtexture: "potato_sack.jpg" }} riverbed={{ texture: "potato_sack.jpg" }} />
    {/* Its parts grow and rise in the water it owns: seaweed where it is deep enough, bubbles off its bed. */}
    <Lake depth={26}>
      <SeaweedField />
      <WaterBubbles />
    </Lake>
  </Biome>,
);
