import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { roadWidth } from "./getVertexBiomeData";
import { loadTextures } from "./materialUtils";

export const getMasterMaterial = async (biomes: Biome[]) => {
  const [roadTexture, sandTexture, grassTexture, bluemudTexture] = await loadTextures([
    "road.png",
    "potato_sack.jpg",
    "moss.png",
    "blue_mud.jpg",
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      roadtexture: { value: roadTexture },
      sandtexture: { value: sandTexture },
      grasstexture: { value: grassTexture },
      bluemudtexture: { value: bluemudTexture },
    },
    vertexShader: `
    attribute float distanceToRoadCenter;
    attribute float biomeId;
    varying float vDistanceToRoadCenter;
    flat varying int vBiomeId;
    varying vec2 vUv;

    void main() {
      vDistanceToRoadCenter = distanceToRoadCenter;
      vBiomeId = int(biomeId);
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    varying float vDistanceToRoadCenter;
    flat varying int vBiomeId;
    uniform sampler2D roadtexture;
    uniform sampler2D sandtexture;
    uniform sampler2D grasstexture;
    uniform sampler2D bluemudtexture;
    varying vec2 vUv;
        
    void city_frag() {
      gl_FragColor = texture2D(grasstexture, vUv);
    } 

    void dust_frag() {
      gl_FragColor = texture2D(sandtexture, vUv);
    }

    void pharmasea_frag() {
      gl_FragColor = texture2D(bluemudtexture, vUv);
    } 
    
    void main() {
      if (vDistanceToRoadCenter < ${roadWidth}.0) {
        gl_FragColor = texture2D(roadtexture, vUv);
      } else {
        ${biomes
          .map((biome, index) => {
            return `if (vBiomeId == ${index}) {
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
