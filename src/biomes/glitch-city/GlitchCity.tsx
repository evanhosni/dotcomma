import { Dimension, Region } from "../../types/Biome";
import { City } from "../city/City";
import { Dust } from "../dust/Dust";
import { Grass } from "../grass/Grass";
import { getMaterial } from "./getMaterial";
import { getRegionData } from "./getRegionData";

export const CityRegion: Region = {
  name: "city",
  biomes: [City, Grass],
};

export const GrassRegion: Region = {
  name: "grass",
  biomes: [Grass],
};

export const DesertRegion: Region = {
  name: "desert",
  biomes: [Dust],
};

export const GlitchCity: Dimension = {
  name: "glitch-city",
  regions: [CityRegion, GrassRegion, DesertRegion],
  getRegionData: getRegionData,
  getMaterial: getMaterial,
};
