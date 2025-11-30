import { Biome } from "../../../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  id: 1,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  blendWidth: 3,
  joinable: true,
  blendable: false,
};
