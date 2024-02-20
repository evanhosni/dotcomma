import { Biome } from "../../types/Biome";
import { getVertexData } from "./getVertexData";

export const Dust: Biome = {
  name: "dust",
  borderWidth: 20,
  getVertexData: getVertexData,
};
