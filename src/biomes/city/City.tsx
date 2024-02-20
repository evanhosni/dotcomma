import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  borderWidth: 100,
  getVertexData: getVertexData,
};
