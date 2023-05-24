import {noise} from '../engine/noise/noise.js';

export const cellworld = (function() {

    const road = {

    }

    const blocks = {
        bierce: {

        },
        pierce: {

        },
        flierce: {

        }
    }

    class Cellworld {
        constructor() {
            this.noise = new noise.Noise({
                octaves: 2,
                persistence: 0.707,
                lacunarity: 1.8,
                exponentiation: 2,
                height: 200.0,
                scale: 3000.0,
                noiseType: 'simplex',
                seed: 1
            })
        }

        // GetHeight(x,y) {
        //     return this.noise.Get(x,y)
        // }

        GetBlock(x,y) {
            const gridSize = 1000
            const roadWidth = 100
            // const blendWidth = 250 //TODO this is unused. Intended to be used to blend area surrounding roads
            const currentGrid = [Math.floor(x/gridSize),Math.floor(y/gridSize)]
            var points = []

            for (let ix = currentGrid[0] - 1; ix < currentGrid[0] + 2; ix++) {
                for (let iy = currentGrid[1] - 1; iy < currentGrid[1] + 2; iy++) {
                    var pointX = new Math.seedrandom(ix + "X" + iy)()
                    var pointY = new Math.seedrandom(ix + "Y" + iy)()
                    var point = new THREE.Vector3((ix + pointX) * gridSize, (iy + pointY) * gridSize, 0)
        
                    points.push(point)
                }
            }

            var currentVertex = new THREE.Vector3(x,y,0)
            points.sort((a,b) => {
                var distanceA = currentVertex.distanceTo(new THREE.Vector3(a.x,a.y,0))
                var distanceB = currentVertex.distanceTo(new THREE.Vector3(b.x,b.y,0))

                return distanceA - distanceB
            })
            var closest = points[0]
            var blockType = blocks[Math.floor(new Math.seedrandom(closest)() * blocks.length)];

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

            return blockType
        }


        GetHeight(x,y) {
            const block = this.GetBlock(x,y)

            if (block == road) return -100
        
            return 0
        }
    }
  
    return {
      Cellworld: Cellworld
    }
  })();