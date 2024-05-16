import { ScatterGrid } from "../../_/_scatter";
import { Biome } from "../../types/Biome";
import { Dimension } from "../../types/Dimension";
import { Region } from "../../types/Region";

export const getSpawners = (dimension: Dimension, x: number, y: number) => {
  const spawners: ScatterGrid[] = [];

  const biomes: Biome[] = Array.from(
    new Set(
      dimension.regions.reduce((acc: Biome[], curr: Region) => {
        return acc.concat(curr.biomes);
      }, [])
    )
  );

  biomes.forEach((biome) => {
    // if (biome.getSpawners(dimension)) {
    spawners.push(...biome.getSpawners(dimension, x, y));
    // }
  });

  return spawners;
};
