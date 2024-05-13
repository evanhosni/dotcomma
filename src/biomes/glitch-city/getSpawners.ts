import { Biome } from "../../types/Biome";
import { Region } from "../../types/Region";
import { Spawner } from "../../types/Spawner";
import { GlitchCityDimension } from "./GlitchCity";

export const getSpawners = () => {
  const spawners: Spawner[] = [];

  const biomes: Biome[] = Array.from(
    new Set(
      GlitchCityDimension.regions.reduce((acc: Biome[], curr: Region) => {
        return acc.concat(curr.biomes);
      }, [])
    )
  );

  biomes.forEach((biome) => {
    if (biome.getSpawners(GlitchCityDimension)) {
      spawners.push(...biome.getSpawners(GlitchCityDimension));
    }
  });

  return spawners;
};
