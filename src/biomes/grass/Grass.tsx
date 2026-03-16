import { Biome } from "../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const Grass: Biome = {
  name: "grass",
  id: 3,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  joinable: true,
  blendable: true,
};
