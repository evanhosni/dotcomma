import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { _math } from "../_/math";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";

export const Biomes = () => {
  const getVertexData = (x: number, y: number) => {
    var vertexData = {
      blockType: "",
      blendData: [],
    };
    const gridSize = 500;
    const roadWidth = 20;
    const currentGrid = [Math.floor(x / gridSize), Math.floor(y / gridSize)];
    var points = [];

    for (let ix = currentGrid[0] - 1; ix <= currentGrid[0] + 1; ix++) {
      for (let iy = currentGrid[1] - 1; iy <= currentGrid[1] + 1; iy++) {
        var pointX = _math.seed_rand(ix + "X" + iy);
        var pointY = _math.seed_rand(ix + "Y" + iy);
        var point = new THREE.Vector3(
          (ix + pointX) * gridSize,
          (iy + pointY) * gridSize,
          0
        );

        points.push(point);
      }
    }

    var currentVertex = new THREE.Vector3(x, y, 0);
    points.sort((a, b) => {
      var distanceA = currentVertex.distanceTo(new THREE.Vector3(a.x, a.y, 0)); //TODO make everything vector2
      var distanceB = currentVertex.distanceTo(new THREE.Vector3(b.x, b.y, 0));

      return distanceA - distanceB;
    });
    var closest = points[0];
    vertexData.blockType = "city"; // blocks[Math.floor(_math.seed_rand(closest) * blocks.length)];

    for (
      let ix = currentVertex.x - roadWidth;
      ix < currentVertex.x + roadWidth;
      ix += roadWidth
    ) {
      for (
        let iy = currentVertex.y - roadWidth;
        iy < currentVertex.y + roadWidth;
        iy += roadWidth
      ) {
        var nearbyVertex = new THREE.Vector3(ix, iy, 0);
        var neighborPoints = [...points];
        neighborPoints.sort((a, b) => {
          var distanceA = nearbyVertex.distanceTo(
            new THREE.Vector3(a.x, a.y, 0)
          );
          var distanceB = nearbyVertex.distanceTo(
            new THREE.Vector3(b.x, b.y, 0)
          );

          return distanceA - distanceB;
        });
        var neighborClosest = neighborPoints[0];
        //var neighborBlockType = blocks[Object.keys(blocks)[ Object.keys(blocks).length * new Math.seedrandom(neighborClosest)() << 0]];

        if (
          closest !=
          neighborClosest /*&& blockType != neighborBlockType/*TODO if u  want to combine neighbor blocks, uncomment this section and the above neighborBlockType line*/
        )
          return "road";
      }
    }

    return vertexData;
  };

  const getHeight = (x: number, y: number) => {
    const vertexData = getVertexData(x, y);

    if (vertexData == "road") return -2;

    // var z = vertexData.blockType.GetHeight(x,y)

    // var z = 0
    // for (let i = 0; i < vertexData.blendData.length; i++) {
    //     z += vertexData.blockType.GetHeight(x,y) * vertexData.blendData[i].blendRatio
    // }

    return 0;
    // return block.GetHeight(x, y)// + vertexData.blendRatio// + overallHeight.noise.Get(x, y)
  };

  const getMaterial = (x: number, y: number) => {
    const terrainHeight = getHeight(x, y); // not sure if this is actually doing anything

    return new THREE.ShaderMaterial({
      wireframe: true,
      uniforms: {
        // not sure if this is actually doing anything
        berrainHeight: { value: terrainHeight },
      }, //
      vertexShader: `
      varying float vTerrainHeight;
    
      void main() {
        vTerrainHeight = position.z; // Assuming Y is the height axis, adjust if needed
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
      fragmentShader: `
        varying float vTerrainHeight;
  
        void main() {
          // Define colors for low and high terrain heights
          vec3 lowColor = vec3(0.0, 0.0, 0.0); // Black
          vec3 highColor = vec3(1.0, 0.0, 0.0); // Red
  
          // Adjust these values based on your terrain height range
          float minHeight = -2.0;
          float maxHeight = 0.0;
  
          // Interpolate between low and high colors based on terrain height
          float gradient = (vTerrainHeight - minHeight) / (maxHeight - minHeight);
          vec3 interpolatedColor = mix(lowColor, highColor, smoothstep(0.0, 1.0, gradient));
  
          gl_FragColor = vec4(interpolatedColor, 1.0);
        }
      `,
    });
  };

  return (
    <Canvas>
      <Controls />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain getHeight={getHeight} getMaterial={getMaterial} />
    </Canvas>
  );
};
