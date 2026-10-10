import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { getNightBlend, MOON_DIRECTION, SUN_DIRECTION } from "./dayNight";

// A flat ambient lit every face turned from the sun identically, so a building's shadow side read
// as one silhouette by day. The hemisphere separates up/side/down faces (ledges, overhangs) and
// the fill separates the two shadow-side walls; at night both fall back to a plain ambient.
const DAY_HEMISPHERE = 0.55;
const NIGHT_HEMISPHERE = 0.12;
const DAY_SKY_COLOR = new THREE.Color("#dce8ff");
const DAY_GROUND_COLOR = new THREE.Color("#8c8172");
const NIGHT_HEMISPHERE_COLOR = new THREE.Color("#ffffff");
const DAY_DIRECTIONAL = 1.0;
const NIGHT_DIRECTIONAL = 0.08;
const DAY_FILL = 0.3;
const NIGHT_FILL = 0;
/** Low and off the sun's opposite azimuth, so -x and +z walls (both away from the sun) differ. */
const FILL_DIRECTION = new THREE.Vector3(-0.8, 0.3, 0.25).normalize();

const _dir = new THREE.Vector3();

/** Unlit shaders (terrain, grass) dim via NIGHT_BLEND_UNIFORM instead; building interiors
 *  deliberately stay bright. */
export const DayNightLights = () => {
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const directionalRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);

  useFrame(() => {
    const blend = getNightBlend();
    const hemisphere = hemisphereRef.current;
    if (hemisphere) {
      hemisphere.intensity = DAY_HEMISPHERE + (NIGHT_HEMISPHERE - DAY_HEMISPHERE) * blend;
      hemisphere.color.lerpColors(DAY_SKY_COLOR, NIGHT_HEMISPHERE_COLOR, blend);
      hemisphere.groundColor.lerpColors(DAY_GROUND_COLOR, NIGHT_HEMISPHERE_COLOR, blend);
    }
    if (fillRef.current) fillRef.current.intensity = DAY_FILL + (NIGHT_FILL - DAY_FILL) * blend;
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
      <hemisphereLight
        ref={hemisphereRef}
        args={[DAY_SKY_COLOR, DAY_GROUND_COLOR, DAY_HEMISPHERE]}
      />
      <directionalLight
        ref={directionalRef}
        position={SUN_DIRECTION.clone().multiplyScalar(100).toArray()}
        intensity={DAY_DIRECTIONAL}
      />
      <directionalLight
        ref={fillRef}
        position={FILL_DIRECTION.clone().multiplyScalar(100).toArray()}
        intensity={DAY_FILL}
      />
    </>
  );
};
