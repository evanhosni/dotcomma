import { Region } from "../../../../components";
import { WireBiome } from "./biomes/wire/biome";

/** Only mounted by HomeDomain, never alongside the game regions. */
export const HomeRegion = () => (
  <Region name="home" id={4}>
    <WireBiome />
  </Region>
);
