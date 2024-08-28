import { _utils } from "../../_/_utils";
import { Biome } from "../../types/Biome";
import { Spawner } from "../../types/Spawner";
import { GlitchCity } from "./GlitchCity";

export const getSpawners = async (x: number, y: number): Promise<Spawner[]> => {
  const biomes: Biome[] = _utils.getAllBiomes(GlitchCity);

  const spawnerPromises = biomes.map((biome) => biome.getSpawners(x, y));

  const spawnerArrays = await Promise.all(spawnerPromises);

  const points: Spawner[] = spawnerArrays.flat();

  return points;
};
