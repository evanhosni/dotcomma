import { _material } from "../../../utils/material/_material";
import { Region, RegionMaterialData } from "../../../world/types";
import { City } from "../biomes/city/City";
import { Grass } from "../biomes/grass/Grass";

const getMaterial = async (): Promise<RegionMaterialData> => {
  const [biomeTexture] = await _material.loadTextures(["road.jpg"]);

  return {
    biomeTexture,
  };
};

export const CityRegion: Region = {
  name: "city",
  id: 3,
  biomes: [City, Grass],
  getMaterial,
};
