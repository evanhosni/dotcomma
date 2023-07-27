import { noise } from "../engine/noise/noise.js";

import { glitchcity } from "./glitchcity.js";
import { pharmaforest } from "./pharmaforest.js";
import { dustworld } from "./dustworld.js";
import { road } from "./road.js";

export const biomes = (function () {
    // const road = {
    //     noise: new noise.Noise({
    //         octaves: 6,
    //         persistence: 0.707,
    //         lacunarity: 1.8,
    //         exponentiation: 4.5,
    //         height: 0.0,
    //         scale: 1100.0,
    //         noiseType: 'simplex',
    //         seed: 1
    //     }),
    //     material: "whatever",
    //     tempValueForHeight: -100
    // }
    // const overallHeight = {
    //     noise: new noise.Noise({
    //         octaves: 2,
    //         persistence: 0.707,
    //         lacunarity: 1.8,
    //         exponentiation: 2,
    //         height: 500.0,
    //         scale: 30000.0,
    //         noiseType: 'simplex',
    //         seed: 1
    //     }),
    // }

    var maxH = 0;
    const overallHeight = 4000;
    const baseHeight = {
        noise: new noise.Noise({
            octaves: 1, //number of levels or layers of perlin noise
            persistence: 1, //influence or importance of each octave - higher for bumpier terrains
            lacunarity: 1, //change in frequency between successive octaves - higher for sharper cliffs and stuff
            exponentiation: 5, //determines how quickly the amplitude decreases with each successive octave. think of it as the exponent applied to persistence
            height: overallHeight,
            scale: overallHeight * 2,
            noiseType: "perlin",
            seed: 1,
        }),
    };
    const dryWet = {
        noise: new noise.Noise({
            octaves: 1,
            persistence: 1,
            lacunarity: 1,
            exponentiation: 5,
            height: overallHeight,
            scale: overallHeight,
            noiseType: "perlin",
            seed: 2,
        }),
    };

    const blocks = [
        new glitchcity.GlitchCity(),
        // new glitchcity.GlitchCity(),
        new pharmaforest.PharmaForest(),
        new dustworld.Dustworld(),
    ];

    class BiomeGenerator {
        GetVertexData(x, y) {
            var vertexData = {
                biome: null,
                baseHeight: null,
                dryWet: null,
                river: false,
            };

            //GET DRY/WET? HAVE DRY AREAS WITHOUT RIVERS?
            let dryWetZ = dryWet.noise.Get(x, y);
            vertexData.dryWet = dryWetZ / overallHeight;
            //use this to mask out/add to baseHeight in order to get some dry areas (without rivers) and maybe some wetter areas (with lakes?)

            //GET BASEHEIGHT AND RIVERS
            let baseHeightZ =
                Math.abs(baseHeight.noise.Get(x, y) - overallHeight / 20) -
                overallHeight / 50;
            if (baseHeightZ < 0) {
                vertexData.river = true;
                baseHeightZ += -(baseHeightZ * (0.2 * baseHeightZ));
            }
            vertexData.baseHeight = baseHeightZ;

            if (baseHeightZ / overallHeight > maxH)
                maxH = baseHeightZ / overallHeight;
            console.log(maxH);

            //GET CITY BLOCKS
            const gridSize = 10000;
            const roadWidth = 500;
            const currentGrid = [
                Math.floor(x / gridSize),
                Math.floor(y / gridSize),
            ];
            var points = [];
            var currentVertex = new THREE.Vector2(x, y);
            vertexData.biome =
                blocks[
                    Math.floor(
                        new Math.seedrandom(currentGrid)() * blocks.length
                    )
                ];

            return vertexData;
        }

        Height(x, y) {
            const vertexData = this.GetVertexData(x, y);

            if (vertexData == "circ") return 50000;
            if (vertexData == "point") return 50000;

            if (vertexData == road) return -100;

            var z = vertexData.baseHeight - 5000;

            // var z = 0
            // for (let i = 0; i < vertexData.blendData.length; i++) {
            //     z += vertexData.blockType.GetHeight(x,y) * vertexData.blendData[i].blendRatio
            // }

            return z;
            // return block.GetHeight(x, y)// + vertexData.blendRatio// + overallHeight.noise.Get(x, y)
        }
    }

    return {
        Biomes: BiomeGenerator,
    };
})();
