import { _math } from "../../math";
import { _noise } from "../../noise";

// import { glitchcity } from "./glitchcity";
// import { pharmaforest } from "./pharmaforest";
// import { dustworld } from "./dustworld";
import * as THREE from 'three';

export namespace _biomes {
  const overallHeight = 4000;

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

      return _noise.simplex(x, y);
    }
  }

  export const Biomes = BiomeGenerator;
}
