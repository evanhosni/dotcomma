import { Material, Region } from "../../../../components";
import { GrassBiome } from "./biomes/grass/biome";

/** Pure grassland region. */
export const GrassRegion = () => (
  <Region name="grass" id={1}>
    <Material texture="moss.png" />
    <GrassBiome />
  </Region>
);
