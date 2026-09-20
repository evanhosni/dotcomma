import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { getNightBlend, MOON_DIRECTION, SUN_DIRECTION } from "./dayNight";

const DAY_AMBIENT = 0.5;
const NIGHT_AMBIENT = 0.12;
const DAY_DIRECTIONAL = 1.0;
const NIGHT_DIRECTIONAL = 0.08;

const _dir = new THREE.Vector3();

/** Unlit shaders (terrain, grass) dim via NIGHT_BLEND_UNIFORM instead; building interiors
 *  deliberately stay bright. */
export const DayNightLights = () => {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const blend = getNightBlend();
    if (ambientRef.current) ambientRef.current.intensity = DAY_AMBIENT + (NIGHT_AMBIENT - DAY_AMBIENT) * blend;
    const directional = directionalRef.current;
    if (directional) {
      directional.intensity = DAY_DIRECTIONAL + (NIGHT_DIRECTIONAL - DAY_DIRECTIONAL) * blend;
      // Normalized so the sun → moon swing passes overhead.
      _dir
        .copy(SUN_DIRECTION)
        .multiplyScalar(1 - blend)
        .addScaledVector(MOON_DIRECTION, blend)
        .normalize();
      directional.position.copy(_dir).multiplyScalar(100);
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={DAY_AMBIENT} />
      <directionalLight
        ref={directionalRef}
        position={SUN_DIRECTION.clone().multiplyScalar(100).toArray()}
        intensity={DAY_DIRECTIONAL}
      />
    </>
  );
};
