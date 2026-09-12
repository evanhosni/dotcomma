import { Biome, Material, Terrain } from "../../../../../../components";
import { getMaterial } from "./material";
import { DUST_BIOME } from "./spec";

import { DUST_BIOME_ID } from "../../../../../../constants";
export { DUST_BIOME_ID };

/** Desert biome: dusty dunes. */
export const DustBiome = () => (
  <Biome spec={DUST_BIOME}>
    <Terrain noise={DUST_BIOME.noise} />
    <Material getMaterial={getMaterial} />
  </Biome>
);
