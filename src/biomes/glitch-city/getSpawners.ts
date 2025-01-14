import { _utils } from "../../_/_utils";
import { Biome } from "../../types/Biome";
import { Spawner } from "../../types/Spawner";
import { GlitchCity } from "./GlitchCity";

export const getSpawners = async (x: number, y: number): Promise<Spawner[]> => {
  const biomes: Biome[] = _utils.getAllBiomes(GlitchCity);

  const points = await Promise.all(biomes.map((biome) => biome.getSpawners(x, y)));

  return points.flat();
};
