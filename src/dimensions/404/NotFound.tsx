import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import { Player } from "../../player/Player";

export const NotFound = () => {
  const getHeight = (x: number, y: number) => {
    return 0;
  };

  const getMaterial = () => {
    return new THREE.ShaderMaterial({
      wireframe: true,

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
            float minHeight = 0.0;
            float maxHeight = 1.0;
    
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
      <Player />
      {/* <Terrain getHeight={getHeight} getMaterial={getMaterial} /> */}
    </Canvas>
  );
};
