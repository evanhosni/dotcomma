import { Biome } from "../../types/Biome";
import { Dimension } from "../../types/Dimension";
import { Region } from "../../types/Region";

export const getSpawners = (dimension: Dimension, x: number, y: number) => {
  const points: THREE.Vector3[] = [];

  const biomes: Biome[] = Array.from(
    new Set(
      dimension.regions.reduce((acc: Biome[], curr: Region) => {
        return acc.concat(curr.biomes);
      }, [])
    )
  );

  biomes.forEach((biome) => {
    // if (biome.getSpawners(dimension)) {
    points.push(...biome.getSpawners(dimension, x, y));
    // }
  });

  return points;
};
