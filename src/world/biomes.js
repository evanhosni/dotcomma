import {noise} from '../engine/noise/noise.js';

import { glitchcity } from './glitchcity.js';
import { pharmaforest } from './pharmaforest.js';
import { dustworld } from './dustworld.js';

export const biomes = (function() {

    const road = {
        noise: new noise.Noise({
            octaves: 6,
            persistence: 0.707,
            lacunarity: 1.8,
            exponentiation: 4.5,
            height: 0.0,
            scale: 1100.0,
            noiseType: 'simplex',
            seed: 1
        }),
        material: "whatever",
        tempValueForHeight: -100
    }
    const overallHeight = {
        noise: new noise.Noise({
            octaves: 2,
            persistence: 0.707,
            lacunarity: 1.8,
            exponentiation: 2,
            height: 500.0,
            scale: 30000.0,
            noiseType: 'simplex',
            seed: 1
        }),
    }
    const blocks = [
        new glitchcity.GlitchCity(),
        // new glitchcity.GlitchCity(),
        new pharmaforest.PharmaForest(),
        new dustworld.Dustworld(),
    ]


    class BiomeGenerator {
        GetVertexData(x,y) {
            var vertexData = {
                blockType: null,
                blendData: []
            }
            const gridSize = 10000
            const roadWidth = 750
            const currentGrid = [Math.floor(x/gridSize),Math.floor(y/gridSize)]
            var points = []

            for (let ix = currentGrid[0] - 1; ix <= currentGrid[0] + 1; ix++) {
                for (let iy = currentGrid[1] - 1; iy <= currentGrid[1] + 1; iy++) {
                    var pointX = new Math.seedrandom(ix + "X" + iy)()
                    var pointY = new Math.seedrandom(ix + "Y" + iy)()
                    var point = new THREE.Vector3((ix + pointX) * gridSize, (iy + pointY) * gridSize, 0)
        
                    points.push(point)
                }
            }

            var currentVertex = new THREE.Vector3(x,y,0)
            points.sort((a,b) => {
                var distanceA = currentVertex.distanceTo(new THREE.Vector3(a.x,a.y,0)) //TODO make everything vector2
                var distanceB = currentVertex.distanceTo(new THREE.Vector3(b.x,b.y,0))

                return distanceA - distanceB
            })
            var closest = points[0]
            vertexData.blockType = blocks[Math.floor(new Math.seedrandom(closest)() * blocks.length)];

            for (let ix = currentVertex.x - roadWidth; ix < currentVertex.x + roadWidth; ix += roadWidth) {
                for (let iy = currentVertex.y - roadWidth; iy < currentVertex.y + roadWidth; iy += roadWidth) {
                    var nearbyVertex = new THREE.Vector3(ix,iy,0)
                    var neighborPoints = [...points]
                    neighborPoints.sort((a,b) => {
                        var distanceA = nearbyVertex.distanceTo(new THREE.Vector3(a.x,a.y,0))
                        var distanceB = nearbyVertex.distanceTo(new THREE.Vector3(b.x,b.y,0))

                        return distanceA - distanceB
                    })
                    var neighborClosest = neighborPoints[0]
                    //var neighborBlockType = blocks[Object.keys(blocks)[ Object.keys(blocks).length * new Math.seedrandom(neighborClosest)() << 0]];

                    if (closest != neighborClosest /*&& blockType != neighborBlockType/*TODO if u  want to combine neighbor blocks, uncomment this section and the above neighborBlockType line*/) return road
                }
            }
            
            return vertexData
        }


        Height(x,y) {
            const vertexData = this.GetVertexData(x,y)

            if (vertexData == road) return -100

            var z = vertexData.blockType.GetHeight(x,y)

            // var z = 0
            // for (let i = 0; i < vertexData.blendData.length; i++) {
            //     z += vertexData.blockType.GetHeight(x,y) * vertexData.blendData[i].blendRatio
            // }

            return z
            // return block.GetHeight(x, y)// + vertexData.blendRatio// + overallHeight.noise.Get(x, y)
        }

        
    
    }
  
    return {
      Biomes: BiomeGenerator
    }
  })();