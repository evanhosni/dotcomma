import { Region } from "../../../../components";
import { WireBiome } from "./biomes/wire/biome";
import { HOME_REGION } from "./spec";

export const HomeRegion = () => <Region spec={HOME_REGION} biomes={{ wire: WireBiome }} />;
