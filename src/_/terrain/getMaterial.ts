import * as THREE from "three";
import { City } from "../../biomes/city/City";
import { Dust } from "../../biomes/dust/Dust";
import { Grass } from "../../biomes/grass/Grass";
import { Pharmasea } from "../../biomes/pharma/Pharma";
import { Biome } from "../../types/Biome";
import { loadTextures } from "./materialUtils";

const blendDistance = 5;

export const getMaterial = async (biomes: Biome[]) => {
  const [roadTexture, sidewalkTexture, grassTexture, sandTexture, mudTexture, bluemudTexture] = await loadTextures([
    "road.jpg",
    "road.png",
    "moss.png",
    "potato_sack.jpg",
    "brown_mud.jpg",
    "blue_mud.jpg",
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      roadtexture: { value: roadTexture },
      sidewalktexture: { value: roadTexture },
      grasstexture: { value: grassTexture },
      sandtexture: { value: sandTexture },
      mudtexture: { value: mudTexture },
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
    uniform sampler2D mudtexture;
    uniform sampler2D bluemudtexture;
    varying vec2 vUv;
    
    void city_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(${City.borderWidth}.0, ${
      City.borderWidth + blendDistance
    }.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(sidewalktexture, adjustedUV), blendFactor);
    } 

    void grass_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(${Grass.borderWidth}.0, ${
      Grass.borderWidth + blendDistance
    }.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(grasstexture, adjustedUV), blendFactor);
    } 

    void dust_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float blendFactor = smoothstep(${Dust.borderWidth}.0, ${
      Dust.borderWidth + blendDistance
    }.0, vDistanceToRoadCenter);
      gl_FragColor = mix(texture2D(roadtexture, adjustedUV), texture2D(sandtexture, adjustedUV), blendFactor);
    }

    void pharmasea_frag() {
      vec2 adjustedUV = fract(vUv * 16.0);
      float borderWidth = ${Pharmasea.borderWidth}.0;
      float blendDistance = ${blendDistance}.0;
      
      float blendFactor1 = smoothstep(borderWidth, borderWidth + blendDistance, vDistanceToRoadCenter);
      float blendFactor2 = smoothstep(3.0 * borderWidth, 3.0 * borderWidth + 80.0 * blendDistance, vDistanceToRoadCenter);
      
      vec4 roadColor = texture2D(roadtexture, adjustedUV);
      vec4 bluemudColor = texture2D(bluemudtexture, adjustedUV);
      vec4 mudColor = texture2D(mudtexture, adjustedUV);
      
      vec4 finalColor = mix(roadColor, mudColor, blendFactor1);
      finalColor = mix(finalColor, bluemudColor, blendFactor2);
      
      gl_FragColor = finalColor;
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

  console.log(material.fragmentShader);

  return material;
};
