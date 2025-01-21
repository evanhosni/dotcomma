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
}
