import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { TerrainNoiseParams } from "../_/noise";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";
import { getVertexData } from "./voronoi";

const noise: TerrainNoiseParams = {
  type: "simplex",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 10,
  scale: 200,
};

export const Biomes = () => {
  const getHeight = (x: number, y: number) => {
    const vertexData = getVertexData(x, y);

    if (vertexData == "road") return -2;
    if (vertexData == "block") return 0;
    // if (vertexData == "roadCenter") return 5;

    // var z = vertexData.blockType.GetHeight(x,y)

    // var z = 0
    // for (let i = 0; i < vertexData.blendData.length; i++) {
    //     z += vertexData.blockType.GetHeight(x,y) * vertexData.blendData[i].blendRatio
    // }

    return Number(vertexData);
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
          vec3 highColor = vec3(0.1, 0.8, 0.2); // Green
  
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
