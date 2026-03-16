import { Biome } from "../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const Dust: Biome = {
  name: "dust",
  id: 2,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  joinable: true,
  blendable: true,
};
