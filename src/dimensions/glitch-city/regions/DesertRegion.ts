import { _material } from "../../../utils/material/_material";
import { Region, RegionMaterialData } from "../../../world/types";
import { Dust } from "../../dust/Dust";

const getMaterial = async (): Promise<RegionMaterialData> => {
  const [biomeTexture] = await _material.loadTextures(["potato_sack.jpg"]);

  return {
    biomeTexture,
  };
};

export const DesertRegion: Region = {
  name: "desert",
  id: 2,
  biomes: [Dust],
  getMaterial,
};
