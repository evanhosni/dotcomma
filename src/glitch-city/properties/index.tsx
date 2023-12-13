import * as THREE from "three";
import { TerrainNoiseParams, _noise } from "../../_/noise";
import { VertexData, default_vertexData } from "../../types/VertexData";
import { CityProperties } from "./City";

const noise: TerrainNoiseParams = {
  type: "perlin",
  octaves: 1,
  persistence: 1,
  lacunarity: 1,
  exponentiation: 1,
  height: 20,
  scale: 50,
};

const vertexData: VertexData = default_vertexData;

const getVertexData = (x: number, y: number) => {
  vertexData.biome = "test";
  return vertexData;
};

export const GlitchCityProperties = {
  vertexData: (x: number, y: number) => getVertexData(x, y),

  getHeight: (x: number, y: number) => {
    if (_noise.terrain(noise, x, y) > 10) {
      return _noise.terrain(noise, x, y);
    } else {
      return CityProperties.getHeight(x, y);
    }
  },

  getMaterial: (x: number, y: number) => {
    const terrainHeight = GlitchCityProperties.getHeight(x, y); // not sure if this is actually doing anything

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
          vec3 lowColor = vec3(0.0, 1.0, 0.0); // Green
          vec3 highColor = vec3(1.0, 0.0, 0.0); // Red
  
          // Adjust these values based on your terrain height range
          float minHeight = 0.0;
          float maxHeight = 20.0;
  
          // Interpolate between low and high colors based on terrain height
          float gradient = (vTerrainHeight - minHeight) / (maxHeight - minHeight);
          vec3 interpolatedColor = mix(lowColor, highColor, smoothstep(0.0, 1.0, gradient));
  
          gl_FragColor = vec4(interpolatedColor, 1.0);
        }
      `,
    });
  },
};
