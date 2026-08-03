import { Material, Region } from "../../world/components";
import { GrassBiome } from "./biomes/grass/GrassBiome";

/** Pure grassland region. */
export const GrassRegion = () => (
  <Region name="grass" id={1}>
    <Material texture="moss.png" />
    <GrassBiome />
  </Region>
);
