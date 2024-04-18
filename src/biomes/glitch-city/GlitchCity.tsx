import { Dimension, Region } from "../../types/Biome";
import { City } from "../city/City";
import { Dust } from "../dust/Dust";
import { Grass } from "../grass/Grass";
import { Pharmasea } from "../pharma/Pharma";
import { getMaterial } from "./getMaterial";
import { getRegionData } from "./getRegionData";

export const CityRegion: Region = {
  name: "city",
  biomes: [City, Grass],
};

export const PharmaseaRegion: Region = {
  name: "grass",
  biomes: [Pharmasea],
};

export const DesertRegion: Region = {
  name: "desert",
  biomes: [Dust],
};

export const GlitchCity: Dimension = {
  name: "glitch-city",
  regions: [CityRegion, PharmaseaRegion, DesertRegion],
  getRegionData: getRegionData,
  getMaterial: getMaterial,
};
