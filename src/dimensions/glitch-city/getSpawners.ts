import { utils } from "../../utils/utils";
import { Biome, Spawner } from "../../world/types";
import { GlitchCity } from "./GlitchCity";

export const getSpawners = async (x: number, y: number): Promise<Spawner[]> => {
  const biomes: Biome[] = utils.getAllBiomes(GlitchCity);

  const points = await Promise.all(biomes.map((biome) => biome.getSpawners(x, y)));

  return [...points.flat()];
};
