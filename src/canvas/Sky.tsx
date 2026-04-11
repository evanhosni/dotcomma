import { useMemo } from "react";
import * as THREE from "three";

const SKY_RADIUS = 6000;

const VERT = `
varying vec3 vDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vDir = worldPos.xyz - cameraPosition;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
varying vec3 vDir;
void main() {
  float h = normalize(vDir).y;
  vec3 color = h > 0.0
    ? mix(horizonColor, topColor, h)
    : mix(horizonColor, bottomColor, -h);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const Sky = () => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          topColor: { value: new THREE.Color("#4a90d9") },
          horizonColor: { value: new THREE.Color("#87ceeb") },
          bottomColor: { value: new THREE.Color("#666666") },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    [],
  );

  return (
    <mesh renderOrder={-1000}>
      <sphereGeometry args={[SKY_RADIUS, 32, 16]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};
