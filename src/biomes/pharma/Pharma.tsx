import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const Pharmasea: Biome = {
  name: "pharmasea",
  id: 4,
  getVertexData: getVertexData,
  getSpawners: (dimension) => {
    return [];
  },
  joinable: true,
  blendable: true,
};
