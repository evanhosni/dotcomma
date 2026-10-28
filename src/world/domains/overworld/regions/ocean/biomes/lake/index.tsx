import { LakeBubbles } from "../../../../../../../objects/particles/lake-bubbles";
import { SeaweedField } from "../../../../../../../objects/foliage/seaweed";
import { Biome, content, Material, Water } from "../../../../../../components";
import fragmentShader from "./shaders/fragment.glsl";

/** A lake: the water stands at a LEVEL (the region base at the cell's site, blended across
 *  neighbouring water cells), and the terrain is defined relative to it — the shore above it at the
 *  wall, descending over `blendWidth` to `depth` below it. A river reaching it runs on into the
 *  basin and ends there in a pond. */
export const LakeBiome = content(
  <Biome id={8} name="lake" joinable blendWidth={90}>
    {/* The river bed under the lake is the lake floor's own sand: a channel entering the basin wears
        the same texture as the floor around it (both under the one bed shade), so the two meet without a seam. */}
    <Material shader={fragmentShader} textures={{ lakesandtexture: "potato_sack.jpg" }} riverbed={{ texture: "potato_sack.jpg" }} />
    <Water depth={26} />

    <SeaweedField />
    <LakeBubbles />
  </Biome>,
);
