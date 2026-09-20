import { Material, Region } from "../../../../components";
import { DustBiome } from "./biomes/dust/biome";
import { DESERT_REGION } from "./spec";

/** Desert region: dust dunes. */
export const DesertRegion = () => (
  <Region name={DESERT_REGION.name} id={DESERT_REGION.id}>
    <Material texture="potato_sack.jpg" />
    <DustBiome />
  </Region>
);
