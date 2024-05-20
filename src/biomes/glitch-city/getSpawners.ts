import { _utils } from "../../_/_utils";
import { Biome } from "../../types/Biome";
import { Spawner } from "../../types/Spawner";
import { GlitchCity } from "./GlitchCity";

export const getSpawners = (x: number, y: number): Spawner[] => {
  const points: Spawner[] = [];

  const biomes: Biome[] = _utils.getAllBiomes(GlitchCity);

  biomes.forEach((biome) => {
    points.push(...biome.getSpawners(x, y));
  });

  return points;
};
