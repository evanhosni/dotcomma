import { Region } from "../world/types";
import { WorldConfig, SerializedRegion } from "./vertexCompute";

/**
 * Builds a serializable WorldConfig from an array of Regions.
 * This config is sent to terrain and spawn workers to initialize
 * the inlined vertex computation pipeline.
 */
export function buildWorldConfig(regions: Region[]): WorldConfig {
  const serializedRegions: SerializedRegion[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    biomes: r.biomes.map((b) => ({
      id: b.id,
      name: b.name,
      joinable: b.joinable,
      blendable: b.blendable,
      blendWidth: b.blendWidth,
    })),
  }));

  return {
    seed: "123",
    regions: serializedRegions,
    gridSize: 500,
    regionGridSize: 2500,
    boundaryWidth: 14,
    defaultBlendWidth: 200,
    roadNoiseParams: {
      type: "perlin",
      octaves: 2,
      persistence: 1,
      lacunarity: 1,
      exponentiation: 1,
      height: 150,
      scale: 250,
    },
    baseNoiseParams: {
      type: "perlin",
      octaves: 3,
      persistence: 2,
      lacunarity: 2,
      exponentiation: 2,
      height: 500,
      scale: 5000,
    },
    biomeNoiseConfigs: {
      // Grass (id=3)
      3: {
        params: {
          type: "perlin",
          octaves: 3,
          persistence: 1,
          lacunarity: 1,
          exponentiation: 1,
          height: 100,
          scale: 100,
        },
      },
      // Dust (id=2)
      2: {
        params: {
          type: "perlin",
          octaves: 3,
          persistence: 1,
          lacunarity: 1,
          exponentiation: 1,
          height: 150,
          scale: 200,
        },
        absNeg: true,
        offset: 50,
      },
      // Pharmasea (id=4)
      4: {
        params: {
          type: "perlin",
          octaves: 5,
          persistence: 1,
          lacunarity: 1,
          exponentiation: 1,
          height: 50,
          scale: 200,
        },
        scale: -3,
      },
    },
    cityConfig: {
      seed: "city1",
      gridSize: 100,
      roadWidth: 10,
      blockCount: 4,
    },
  };
}
