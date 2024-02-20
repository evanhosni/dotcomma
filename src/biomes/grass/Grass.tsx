import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const Grass: Biome = {
  name: "grass",
  borderWidth: 100,
  getVertexData: getVertexData,
};
