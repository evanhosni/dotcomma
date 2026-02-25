import { _material } from "../../../utils/material/_material";
import { Region, RegionMaterialData } from "../../../world/types";
import { Grass } from "../biomes/grass/Grass";

const getMaterial = async (): Promise<RegionMaterialData> => {
  const [biomeTexture] = await _material.loadTextures(["moss.png"]);

  return {
    biomeTexture,
  };
};

export const GrassRegion: Region = {
  name: "grass",
  id: 1,
  biomes: [Grass],
  getMaterial,
};
