import { Biome } from "../../../../world/types";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  id: 1,
  getVertexData: getVertexData,
  blendWidth: 3,
  joinable: true,
  blendable: false,
};
