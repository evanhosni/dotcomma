import { Material, Region } from "../../world/components";
import { DustBiome } from "./biomes/dust/DustBiome";

/** Desert region: dust dunes. */
export const DesertRegion = () => (
  <Region name="desert" id={2}>
    <Material texture="potato_sack.jpg" />
    <DustBiome />
  </Region>
);
