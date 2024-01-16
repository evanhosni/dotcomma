import * as THREE from "three";
import { loadTextures } from "../../../_/terrain/materialUtils";

export const getMaterial = async () => {
  const [sandTexture] = await loadTextures(["potato_sack.jpg"]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      sandtexture: { value: sandTexture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D sandtexture;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(sandtexture, vUv);
      }
    `,
  });

  return material;
};
