import * as THREE from "three";
import { Mesh } from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { createBoxCollider } from "./boxCollider";
import { createCapsuleCollider } from "./capsuleCollider";
import { createSphereCollider } from "./sphereCollider";
import { createTrimeshCollider } from "./trimeshCollider";

export const createColliders = async (gltf: GLTF, scale: THREE.Vector3Tuple, rotation: THREE.Vector3Tuple) => {
  const capsuleColliders: any[] = [];
  const sphereColliders: any[] = [];
  const boxColliders: any[] = [];
  const trimeshColliders: any[] = [];

  for (const child of gltf.scene.children) {
    if (child instanceof Mesh && child.geometry) {
      // if (!child.userData.collision) continue;

      const mesh = child.clone();

      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.scale.multiply(new THREE.Vector3(...scale));

      if (child.userData.capsule) {
        const collider = await createCapsuleCollider(mesh);
        capsuleColliders.push(collider);
        continue;
      }

      if (child.userData.sphere) {
        const collider = await createSphereCollider(mesh);
        sphereColliders.push(collider);
        continue;
      }

      if (child.userData.box) {
        const collider = await createBoxCollider(mesh);
        boxColliders.push(collider);
        continue;
      }

      const collider = await createTrimeshCollider(mesh);
      trimeshColliders.push(collider);
    }
  }

  return { capsuleColliders, sphereColliders, boxColliders, trimeshColliders };
};
