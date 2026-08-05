import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { getNightBlend, MOON_DIRECTION, SUN_DIRECTION } from "./dayNight";

// Scene lighting at each end of the cycle (lerped by the night blend).
const DAY_AMBIENT = 0.5;
const NIGHT_AMBIENT = 0.12;
const DAY_DIRECTIONAL = 1.0;
const NIGHT_DIRECTIONAL = 0.08;

const _dir = new THREE.Vector3();

/**
 * The scene's ambient + directional lights, dimmed with the day/night cycle
 * so lit materials (building exteriors, doors, GLTF spawnables) genuinely
 * darken at night. The directional light shines FROM the sun by day and FROM
 * the moon by night (swinging between them through the transitions), so
 * shading always agrees with the visible celestial body. Unlit shaders
 * (terrain, grass) dim themselves via the shared NIGHT_BLEND_UNIFORM;
 * building interiors deliberately stay bright (they're indoors, with their
 * own light panels).
 */
export const DayNightLights = () => {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const blend = getNightBlend();
    if (ambientRef.current) ambientRef.current.intensity = DAY_AMBIENT + (NIGHT_AMBIENT - DAY_AMBIENT) * blend;
    const directional = directionalRef.current;
    if (directional) {
      directional.intensity = DAY_DIRECTIONAL + (NIGHT_DIRECTIONAL - DAY_DIRECTIONAL) * blend;
      // Only orientation matters for a directional light (target = origin):
      // blend sun → moon and normalize so the swing passes overhead.
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
