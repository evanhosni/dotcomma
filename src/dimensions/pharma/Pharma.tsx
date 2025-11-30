import { Biome } from "../../world/types";
import { getMaterial } from "./getMaterial";
import { getVertexData } from "./getVertexData";

export const Pharmasea: Biome = {
  name: "pharmasea",
  id: 4,
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  joinable: true,
  blendable: true,
};
