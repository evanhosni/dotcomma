import * as THREE from "three";
import { Biome } from "../../types/Biome";
import { loadTextures } from "./materialUtils";

export const getMaterial = async (biomes: Biome[]) => {
  const [roadTexture, sidewalkTexture, grassTexture, sandTexture, bluemudTexture] = await loadTextures([
    "road.jpg",
    "road.png",
    "moss.png",
    "potato_sack.jpg",
    "blue_mud.jpg",
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      roadtexture: { value: roadTexture },
      sidewalktexture: { value: sidewalkTexture },
      grasstexture: { value: grassTexture },
      sandtexture: { value: sandTexture },
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
    uniform sampler2D sidewalktexture;
    uniform sampler2D sandtexture;
    uniform sampler2D grasstexture;
    uniform sampler2D bluemudtexture;
    varying vec2 vUv;
    
    void city_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(10.0, 11.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(sidewalktexture, adjustedUV), blendFactor);
    } 

    void grass_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(10.0, 11.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(grasstexture, adjustedUV), blendFactor);
    } 

    void dust_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(10.0, 11.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(sandtexture, adjustedUV), blendFactor);
    }

    void pharmasea_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(10.0, 11.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(bluemudtexture, adjustedUV), blendFactor);
    } 
    
    void main() {
      ${biomes
        .map((biome, index) => {
          return `if (vBiomeId == ${index}) {
          ${biome.name}_frag();
        }`;
        })
        .join("\n")}
    }
  `,
  });

  return material;
};
