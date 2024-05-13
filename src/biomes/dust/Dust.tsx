import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const Dust: Biome = {
  name: "dust",
  id: 2,
  getVertexData: getVertexData,
  getSpawners: (dimension) => {
    return [];
  },
  joinable: true,
  blendable: true,
};
