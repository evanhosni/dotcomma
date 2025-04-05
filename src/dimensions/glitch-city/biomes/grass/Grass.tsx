import { Biome } from "../../../../world/types";
import { getVertexData } from "./getVertexData";

export const Grass: Biome = {
  name: "grass",
  id: 3,
  getVertexData: getVertexData,
  joinable: true,
  blendable: true,
};
