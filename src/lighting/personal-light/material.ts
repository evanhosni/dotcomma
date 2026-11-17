import * as THREE from "three";

export const PERSONAL_LIGHT_UNIFORM = "uPersonalLight";
export const FLASHLIGHT_UNIFORM = "uFlashlight";
export const FLASHLIGHT_DIR_UNIFORM = "uFlashlightDir";

export const PERSONAL_LIGHT_UNIFORMS = {
  [PERSONAL_LIGHT_UNIFORM]: { value: 0 },
  [FLASHLIGHT_UNIFORM]: { value: 0 },
  [FLASHLIGHT_DIR_UNIFORM]: { value: new THREE.Vector3(0, 0, -1) },
};
