import { Material, Region } from "../../components";
import { DustBiome } from "./biomes/dust/biome";

/** Desert region: dust dunes. */
export const DesertRegion = () => (
  <Region name="desert" id={2}>
    <Material texture="potato_sack.jpg" />
    <DustBiome />
  </Region>
);
