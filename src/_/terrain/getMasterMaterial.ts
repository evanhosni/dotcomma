import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { roadWidth } from "./getVertexBiomeData";
import { loadTextures } from "./materialUtils";

export const getMasterMaterial = async (biomes: Biome[]) => {
  const [roadTexture, sandTexture, grassTexture] = await loadTextures(["road.png", "potato_sack.jpg", "moss.png"]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      roadtexture: { value: roadTexture },
      sandtexture: { value: sandTexture },
      grasstexture: { value: grassTexture },
    },
    vertexShader: `
    attribute float distanceToRoadCenter;
    attribute float biomeId;
    varying float vDistanceToRoadCenter;
    varying float vBiomeId;
    varying vec2 vUv;

    void main() {
      vDistanceToRoadCenter = distanceToRoadCenter;
      vBiomeId = biomeId;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    varying float vDistanceToRoadCenter;
    varying float vBiomeId;
    uniform sampler2D roadtexture;
    uniform sampler2D sandtexture;
    uniform sampler2D grasstexture;
    varying vec2 vUv;
        
    void city_frag() {
      gl_FragColor = texture2D(grasstexture, vUv);
    } 

    void dust_frag() {
      gl_FragColor = texture2D(sandtexture, vUv);
    } 
    
    void main() {
      if (vDistanceToRoadCenter < ${roadWidth}.0) {
        gl_FragColor = texture2D(roadtexture, vUv);
      } else {
        ${biomes
          .map((biome, index) => {
            return `if (vBiomeId + 0.5 == ${index}.5) {
            ${biome.name}_frag();
          }`;
          })
          .join("\n")}
      }
    }
  `,
  });

  return material;
};
