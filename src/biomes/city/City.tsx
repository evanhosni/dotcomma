import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  getVertexData: getVertexData,
  blendWidth: 3,
};
