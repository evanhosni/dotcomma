import { Biome, Dimension, Region } from "../world/types";

export namespace utils {
  export const getAllBiomes = (dimension: Dimension): Biome[] => {
    return Array.from(
      new Set(
        dimension.regions.reduce((biomes: Biome[], region: Region) => {
          return biomes.concat(region.biomes);
        }, [])
      )
    );
  };

  export const getAllBiomesFromRegions = (regions: Region[]): Biome[] => {
    return Array.from(
      new Set(
        regions.reduce((biomes: Biome[], region: Region) => {
          return biomes.concat(region.biomes);
        }, [])
      )
    );
  };

  export const getDistance2D = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
    return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.z - pos2.z, 2));
  };
}
