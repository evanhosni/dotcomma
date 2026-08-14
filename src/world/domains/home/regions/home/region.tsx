import { Region } from "../../../../components";
import { WireBiome } from "./biomes/wire/biome";

/** Home-page region: a single flat wireframe biome. Only mounted by
 *  HomeDomain (route "/"), never alongside the game regions. */
export const HomeRegion = () => (
  <Region name="home" id={4}>
    <WireBiome />
  </Region>
);
