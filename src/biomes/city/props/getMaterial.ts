import * as THREE from "three";
import { loadTextures } from "../../../_/terrain/materialUtils";

export const getMaterial = async () => {
  const [sandTexture, grassTexture] = await loadTextures(["potato_sack.jpg", "moss.png"]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      sandtexture: { value: sandTexture },
      grasstexture: { value: grassTexture },
    },
    vertexShader: `
    attribute float isRoad;
    varying float vIsRoad;
    attribute float biomeType;
    varying float vBiomeType;
    varying vec2 vUv;

    void main() {
      vIsRoad = isRoad;
      vBiomeType = biomeType;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    varying float vIsRoad;
    varying float vBiomeType;

    uniform sampler2D sandtexture;
    uniform sampler2D grasstexture;
    varying vec2 vUv;
  
    
    void main() {
      int index = int(floor(vBiomeType + 0.1));
      
      if (vIsRoad > 0.5) {
        gl_FragColor = texture2D(sandtexture, vUv);
      } else {
        gl_FragColor = texture2D(grasstexture, vUv);
      }
    }
  `,
  });

  return material;
};
