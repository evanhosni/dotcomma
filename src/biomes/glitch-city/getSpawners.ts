import { Biome } from "../../types/Biome";
import { Dimension } from "../../types/Dimension";
import { Region } from "../../types/Region";

export const getSpawners = (dimension: Dimension, x: number, y: number): { point: THREE.Vector3; element: any }[] => {
  const points: { point: THREE.Vector3; element: any }[] = [];

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

//TODO maybe find a way to not run biome specific function in areas that are not same biome?? not sure if possible...
