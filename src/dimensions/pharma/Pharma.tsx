import { Biome } from "../../world/types";
import { getVertexData } from "./getVertexData";

export const Pharmasea: Biome = {
  name: "pharmasea",
  id: 4,
  getVertexData: getVertexData,
  joinable: true,
  blendable: true,
};
