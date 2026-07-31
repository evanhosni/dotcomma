import * as THREE from "three";

/** Objects hidden by GameObject frustum culling. Portal reads this set
 *  to temporarily restore visibility during its virtual-camera render. */
export const frustumHiddenObjects = new Set<THREE.Object3D>();

export const restoreFrustumVisibility = () => {
  frustumHiddenObjects.forEach((obj) => {
    obj.visible = true;
  });
};

export const hideFrustumObjects = () => {
  frustumHiddenObjects.forEach((obj) => {
    obj.visible = false;
  });
};
