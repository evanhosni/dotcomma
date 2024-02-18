import * as THREE from "three";
import { loadTextures } from "../../../_/terrain/materialUtils";
import { roadWidth } from "./getVertexData";

export const getMaterial = async () => {
  const [sandTexture, grassTexture] = await loadTextures(["potato_sack.jpg", "moss.png"]);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      sandtexture: { value: sandTexture },
      grasstexture: { value: grassTexture },
    },
    vertexShader: `
    attribute float distanceToRoadCenter;
    varying float vDistanceToRoadCenter;
    varying vec2 vUv;

    void main() {
      vDistanceToRoadCenter = distanceToRoadCenter;
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
    fragmentShader: `
    varying float vDistanceToRoadCenter;

    uniform sampler2D sandtexture;
    uniform sampler2D grasstexture;
    varying vec2 vUv;

    void grassfrag() {
      gl_FragColor = texture2D(grasstexture, vUv);
    } 
    
    void main() {
      if (vDistanceToRoadCenter < ${roadWidth}.0) {
        gl_FragColor = texture2D(sandtexture, vUv);
      } else {
        grassfrag();
      }
    }
  `,
  });

  return material;
};
