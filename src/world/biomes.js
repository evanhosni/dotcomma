import {noise} from '../engine/noise/noise.js';

import { glitchcity } from './glitchcity.js';
import { pharmaforest } from './pharmaforest.js';
import { dustworld } from './dustworld.js';
import { road } from './road.js';

export const biomes = (function() {

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
            var currentVertex = new THREE.Vector2(x,y)

            for (let ix = currentGrid[0] - 1; ix <= currentGrid[0] + 1; ix++) {
                for (let iy = currentGrid[1] - 1; iy <= currentGrid[1] + 1; iy++) {
                    var pointX = new Math.seedrandom(ix + "X" + iy)()
                    var pointY = new Math.seedrandom(ix + "Y" + iy)()
                    var point = new THREE.Vector2((ix + pointX) * gridSize, (iy + pointY) * gridSize)
        
                    points.push(point)
                }
            }

            points.sort((a,b) => {
                var distanceA = currentVertex.distanceTo(new THREE.Vector2(a.x,a.y))
                var distanceB = currentVertex.distanceTo(new THREE.Vector2(b.x,b.y))

                return distanceA - distanceB
            })
            var closest = points[0]
            vertexData.blockType = blocks[Math.floor(new Math.seedrandom(closest)() * blocks.length)];

            var boundaries = []
            var triangles = []

            ////////////////////////////////////////////TODO
            //// I THInk we need more triangles/midpoints. There are certain situations where the 4 closest triangles aren't enough
            ////////////////////////////////////////////TODO


            const midpointAB = new THREE.Vector2((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2);
            const midpointAC = new THREE.Vector2((points[0].x + points[2].x) / 2, (points[0].y + points[2].y) / 2);
            const midpointBC = new THREE.Vector2((points[1].x + points[2].x) / 2, (points[1].y + points[2].y) / 2);

            const midpoints = [midpointAB,midpointAC,midpointBC]

            const slopeAB = -1 / ((points[1].y - points[0].y) / (points[1].x - points[0].x));
            const slopeAC = -1 / ((points[2].y - points[0].y) / (points[2].x - points[0].x));

            var mainCircumcenter = new THREE.Vector2(
                (slopeAB * midpointAB.x - slopeAC * midpointAC.x + midpointAC.y - midpointAB.y) / (slopeAB - slopeAC),
                slopeAB * (x - midpointAB.x) + midpointAB.y
            )

            for (let i = 0; i < midpoints.length; i++) {
                var secondaryPoints = [...points]

                const indices = [secondaryPoints.indexOf(points[0]),secondaryPoints.indexOf(points[1]),secondaryPoints.indexOf(points[2])]
                for (let j = 0; j < indices.length; j++) {
                    secondaryPoints.splice(indices[i],1)
                }

                secondaryPoints.sort((a,b) => {
                    var distanceA = midpoints[i].distanceTo(new THREE.Vector2(a.x,a.y))
                    var distanceB = midpoints[i].distanceTo(new THREE.Vector2(b.x,b.y))
                    return distanceA - distanceB
                })

                let pointA, pointB
                let pointC = secondaryPoints[0]

                if (midpoints[i] == midpointAB) {
                    pointA = points[0]
                    pointB = points[1]
                } else if (midpoints[i] == midpointAC) {
                    pointA = points[0]
                    pointB = points[2]
                } else if (midpoints[i] == midpointBC) {
                    pointA = points[1]
                    pointB = points[2]
                }

                triangles.push([pointA,pointB,pointC])
            }

            for (let i = 0; i < triangles.length; i++) {
                let newMidpointAB = new THREE.Vector2((triangles[i][0].x + triangles[i][1].x) / 2, (triangles[i][0].y + triangles[i][1].y) / 2);
                let newMidpointAC = new THREE.Vector2((triangles[i][0].x + triangles[i][2].x) / 2, (triangles[i][0].y + triangles[i][2].y) / 2);

                let newSlopeAB = -1 / ((triangles[i][1].y - triangles[i][0].y) / (triangles[i][1].x - triangles[i][0].x));
                let newSlopeAC = -1 / ((triangles[i][2].y - triangles[i][0].y) / (triangles[i][2].x - triangles[i][0].x));

                var newCircWhoDis = new THREE.Vector2(
                    (newSlopeAB * newMidpointAB.x - newSlopeAC * newMidpointAC.x + newMidpointAC.y - newMidpointAB.y) / (newSlopeAB - newSlopeAC),
                    newSlopeAB * (x - newMidpointAB.x) + newMidpointAB.y
                )

                boundaries.push([mainCircumcenter,newCircWhoDis])
            }

            var distancesToBoundaries = []
            for (let i = 0; i < boundaries.length; i++) {
                var lineStart = boundaries[i][0];
                var lineEnd = boundaries[i][1];

                var lineVectorX = lineEnd.x - lineStart.x;
                var lineVectorY = lineEnd.y - lineStart.y;

                var pointVectorX = currentVertex.x - lineStart.x;
                var pointVectorY = currentVertex.y - lineStart.y;

                var dotProduct = lineVectorX * pointVectorX + lineVectorY * pointVectorY;

                var lineLengthSquared = lineVectorX * lineVectorX + lineVectorY * lineVectorY;

                var shortestDistance;
                var xDiff, yDiff;

                if (dotProduct <= 0) {
                    xDiff = lineStart.x - currentVertex.x;
                    yDiff = lineStart.y - currentVertex.y;
                } else if (dotProduct >= lineLengthSquared) {
                    xDiff = lineEnd.x - currentVertex.x;
                    yDiff = lineEnd.y - currentVertex.y;
                } else {
                    var projectionFactor = dotProduct / lineLengthSquared;
                    var projectionX = lineStart.x + projectionFactor * lineVectorX;
                    var projectionY = lineStart.y + projectionFactor * lineVectorY;
                    var projectedPoint = new THREE.Vector2(projectionX, projectionY)
                    xDiff = projectedPoint.x - currentVertex.x;
                    yDiff = projectedPoint.y - currentVertex.y;
                }
                shortestDistance = Math.sqrt(xDiff * xDiff + yDiff * yDiff);

                distancesToBoundaries.push(shortestDistance);
            }

            distancesToBoundaries.sort()
            vertexData.distanceToEdge = distancesToBoundaries[0]

            if (vertexData.distanceToEdge < roadWidth) vertexData.blockType = new road.Road()

            // for (let i = 0; i < circumcenters.length; i++) {
            //     if (currentVertex.distanceTo(circumcenters[i]) < 200) {
            //         // console.log("hey")
            //         return "circ"
            //     }
            // }

            for (let i = 0; i < points.length; i++) {
                if (currentVertex.distanceTo(points[i]) < 200) {
                    // console.log("hey")
                    return "point"
                }
            }


            // for (let ix = currentVertex.x - roadWidth; ix < currentVertex.x + roadWidth; ix += roadWidth) {
            //     for (let iy = currentVertex.y - roadWidth; iy < currentVertex.y + roadWidth; iy += roadWidth) {
            //         var nearbyVertex = new THREE.Vector2(ix,iy)
            //         var neighborPoints = [...points]
            //         neighborPoints.sort((a,b) => {
            //             var distanceA = nearbyVertex.distanceTo(new THREE.Vector2(a.x,a.y))
            //             var distanceB = nearbyVertex.distanceTo(new THREE.Vector2(b.x,b.y))

            //             return distanceA - distanceB
            //         })
            //         var neighborClosest = neighborPoints[0]
            //         //var neighborBlockType = blocks[Object.keys(blocks)[ Object.keys(blocks).length * new Math.seedrandom(neighborClosest)() << 0]];

            //         if (closest != neighborClosest /*&& blockType != neighborBlockType/*TODO if u  want to combine neighbor blocks, uncomment this section and the above neighborBlockType line*/) return road
            //     }
            // }

            // var circumcenters = []

            // vertexData.distanceToEdge = currentVertex.distanceTo(points[1]) - currentVertex.distanceTo(points[0]) - roadWidth
            
            return vertexData
        }


        Height(x,y) {
            const vertexData = this.GetVertexData(x,y)

            if (vertexData == "circ") return 50000
            if (vertexData == "point") return 50000

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