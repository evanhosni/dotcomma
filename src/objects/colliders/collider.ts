import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { COLLIDER_TYPE } from "./types";

export const colliderWorker = new Worker(new URL("./collider.worker.ts", import.meta.url), {
  type: "module",
});

export const createColliders = async (gltf: GLTF, scale: THREE.Vector3Tuple, rotation: THREE.Vector3Tuple) => {
  const capsuleColliders: any[] = [];
  const sphereColliders: any[] = [];
  const boxColliders: any[] = [];
  const trimeshColliders: any[] = [];

  for (const child of gltf.scene.children) {
    if (child instanceof THREE.Mesh && child.geometry) {
      const mesh = child.clone();
      mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
      mesh.scale.multiply(new THREE.Vector3(...scale));

      let colliderPromise: Promise<any> | null = null;

      if (child.userData.capsule) {
        colliderPromise = createCollider(mesh, COLLIDER_TYPE.CAPSULE);
        capsuleColliders.push(await colliderPromise);
      } else if (child.userData.sphere) {
        colliderPromise = createCollider(mesh, COLLIDER_TYPE.SPHERE);
        sphereColliders.push(await colliderPromise);
      } else if (child.userData.box) {
        //TODO make box a bit more robust, make it able to detect and match object rotation OR make trimesh collision detection better
        colliderPromise = createCollider(mesh, COLLIDER_TYPE.BOX);
        boxColliders.push(await colliderPromise);
      } else if (child.userData.trimesh) {
        colliderPromise = createCollider(mesh, COLLIDER_TYPE.TRIMESH);
        trimeshColliders.push(await colliderPromise);
      }
    }
  }

  return { capsuleColliders, sphereColliders, boxColliders, trimeshColliders };
};

const createCollider = (mesh: THREE.Mesh, type: COLLIDER_TYPE): Promise<any> => {
  return new Promise((resolve) => {
    colliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: type === COLLIDER_TYPE.TRIMESH ? undefined : mesh.geometry.toJSON(),
      positions: type === COLLIDER_TYPE.TRIMESH ? Array.from(mesh.geometry.attributes.position.array) : undefined,
      index: type === COLLIDER_TYPE.TRIMESH && mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    colliderWorker.postMessage({ type, params });
  });
};
