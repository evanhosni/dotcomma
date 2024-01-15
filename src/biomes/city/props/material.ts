import * as THREE from "three";

export const material = new THREE.ShaderMaterial({
  wireframe: true,

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

    uniform sampler2D roadTexture;
    varying vec2 vUv;
  
    
    void main() {
      int index = int(floor(vBiomeType + 0.1));
      
      if (vIsRoad > 0.5) {
        gl_FragColor = vec4(0,0,0,1);//texture2D(roadTexture, vUv);
      } else {
        gl_FragColor = vec4(0.2,0.8,0.5,1);
      }
    }
  `,
});
