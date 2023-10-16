// import { glitchcity } from "./glitchcity";
// import { pharmaforest } from "./pharmaforest";
// import { dustworld } from "./dustworld";

import { _noise } from "../../noise";

export interface BiomeNoiseParams {
  octaves: number;
  persistence: number;
  lacunarity: number;
  exponentiation: number;
  height: number;
  scale: number;
  // noise_type: string, //TODO bring this back if u ever find a use for having both perlin and simplex
  seed: number | string;
}

export interface Biome {
  noise: BiomeNoiseParams;
}

export const BiomeHeight = (biome: Biome, x: number, y: number) => {
  const xs = x / biome.noise.scale;
  const ys = y / biome.noise.scale;
  const G = 2.0 ** -biome.noise.persistence;
  let amplitude = 1.0;
  let frequency = 1.0;
  let normalization = 0;
  let total = 0;
  for (let o = 0; o < biome.noise.octaves; o++) {
    const noiseValue =
      _noise.perlin(xs * frequency, ys * frequency) * 0.5 + 0.5;
    total += noiseValue * amplitude;
    normalization += amplitude;
    amplitude *= G;
    frequency *= biome.noise.lacunarity;
  }
  total /= normalization;
  return Math.pow(total, biome.noise.exponentiation) * biome.noise.height;
};

export namespace _biomes {
  const overallHeight = 40;

  //   const baseHeight: { noise: Noise } = {
  //     noise: new noise.Noise({
  //       octaves: 1,
  //       persistence: 1,
  //       lacunarity: 1,
  //       exponentiation: 5,
  //       height: overallHeight,
  //       scale: overallHeight * 2,
  //       noiseType: "perlin",
  //       seed: 1,
  //     }),
  //   };

  //   const river: { noise: Noise } = {
  //     noise: new noise.Noise({
  //       octaves: 1,
  //       persistence: 1,
  //       lacunarity: 1,
  //       exponentiation: 5,
  //       height: overallHeight,
  //       scale: overallHeight,
  //       noiseType: "perlin",
  //       seed: 2,
  //     }),
  //   };

  //   const blocks: (glitchcity.GlitchCity | pharmaforest.PharmaForest | dustworld.Dustworld)[] = [
  //     new glitchcity.GlitchCity(),
  //     new pharmaforest.PharmaForest(),
  //     new dustworld.Dustworld(),
  //   ];

  class BiomeGenerator {
    // public GetVertexData(x: number, y: number): {
    // //   biome: glitchcity.GlitchCity | pharmaforest.PharmaForest | dustworld.Dustworld | null,
    //   baseHeight: number | null,
    //   river: number | null,
    //   river: boolean,
    // } {
    //   const vertexData = {
    //     biome: null,
    //     baseHeight: null,
    //     river: null,
    //     river: false,
    //   };

    //   let riverZ = river.noise.Get(x, y);
    //   vertexData.river = riverZ / overallHeight;

    //   let baseHeightZ =
    //     Math.abs(baseHeight.noise.Get(x, y) - overallHeight / 20) -
    //     overallHeight / 50;
    //   if (baseHeightZ < 0) {
    //     vertexData.river = true;
    //     baseHeightZ += -(baseHeightZ * (0.2 * baseHeightZ));
    //   }
    //   vertexData.baseHeight = baseHeightZ;

    //   //GET CITY BLOCKS
    //   const gridSize = 10000;
    //   const roadWidth = 500;
    //   const currentGrid = [
    //       Math.floor(x / gridSize),
    //       Math.floor(y / gridSize),
    //   ];
    //   var points = [];
    //   var currentVertex = new THREE.Vector2(x, y);
    //   vertexData.biome =
    //       blocks[
    //           Math.floor(
    //               _math.seed_rand(currentGrid) * blocks.length
    //           )
    //       ];

    //   return vertexData;
    // }

    public Height(x: number, y: number): number {
      //   const vertexData = this.GetVertexData(x, y);

      //   if (vertexData.river) return -100;

      //   var z = vertexData.baseHeight - 5000;

      return 0; //_noise.simplex(x, y);
    }
  }

  export const Biomes = BiomeGenerator;
}
