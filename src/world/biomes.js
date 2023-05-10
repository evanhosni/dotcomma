import {noise} from '../engine/noise/noise.js';

export const biomes = (function() {

    const blocks = [
        {
            name: "road",
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
            material: "whatever"
        },
        {
            name: "grass",
            noise: new noise.Noise({
                octaves: 6,
                persistence: 0.707,
                lacunarity: 1.8,
                exponentiation: 4.5,
                height: 300.0,
                scale: 1100.0,
                noiseType: 'simplex',
                seed: 1
                }),
            material: "whatever"
        },
    ]


    class BiomeGenerator {
        GetBlock(x,y) {
            const gridSize = 2000
            const roadWidth = 150
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
            var closest = points[0],
            secondClosest = points[1]

            for (let ix = currentVertex.x - roadWidth; ix < currentVertex.x + roadWidth; ix += roadWidth) {
                for (let iy = currentVertex.y - roadWidth; iy < currentVertex.y + roadWidth; iy += roadWidth) {
                    var nearbyVertex = new THREE.Vector3(ix,iy,0)
                    var points2 = [...points]
                    points2.sort((a,b) => {
                        var distanceA = nearbyVertex.distanceTo(new THREE.Vector3(a.x,a.y,0))
                        var distanceB = nearbyVertex.distanceTo(new THREE.Vector3(b.x,b.y,0))
        
                        return distanceA - distanceB
                    })

                    if (closest != points2[0]) return blocks[0]
                }
            }

            return 0
        }


        Height(x,y) {
            const block = this.GetBlock(x,y)

            if (block.name == "road") return -100 //TODO yeet

            return 0

            return block.noise.Get(x,y)
        }
    
    }
  
    return {
      Biomes: BiomeGenerator
    }
  })();







  //this was used to generate noise
//   params.bumps = {
//     octaves: 6,
//     persistence: 0.707,
//     lacunarity: 1.8,
//     exponentiation: 4.5,
//     height: 300.0,
//     scale: 1100.0,
//     noiseType: 'simplex',
//     seed: 1
//   };
//   heightGenerators: [new HeightGenerator(this._biomes, this._bumps, offset, 100000, 100000 + 1)],