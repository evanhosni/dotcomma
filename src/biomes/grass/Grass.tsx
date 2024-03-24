import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const Grass: Biome = {
  name: "grass",
  getVertexData: getVertexData,
  joinable: false,
};
