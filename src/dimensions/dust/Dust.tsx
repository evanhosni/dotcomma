import { Biome } from "../../world/types";
import { getVertexData } from "./getVertexData";

export const Dust: Biome = {
  name: "dust",
  id: 2,
  getVertexData: getVertexData,
  getSpawners: async (dimension) => {
    return [];
  },
  joinable: true,
  blendable: true,
};
