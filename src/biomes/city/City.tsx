import { Biome } from "../../world/types";
import { getSpawners } from "./getSpawners";
import { getVertexData } from "./getVertexData";

export const City: Biome = {
  name: "city",
  id: 1,
  getVertexData: getVertexData,
  getSpawners: getSpawners,
  blendWidth: 3,
  joinable: true,
  blendable: false,
};
