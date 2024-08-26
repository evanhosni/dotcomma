import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { COLLIDER_TYPE } from "./colliderWorker";

export const colliderWorker = new Worker(new URL("./colliderWorker.ts", import.meta.url), {
  type: "module",
});

export const createColliders = async (gltf: GLTF, scale: THREE.Vector3Tuple, rotation: THREE.Vector3Tuple) => {
  const capsuleColliders: any[] = [];
  const sphereColliders: any[] = [];
  const boxColliders: any[] = [];
  const trimeshColliders: any[] = [];

  for (const child of gltf.scene.children) {
    if (child instanceof THREE.Mesh && child.geometry) {
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

export const createCapsuleCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    colliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    colliderWorker.postMessage({ type: COLLIDER_TYPE.CAPSULE, params });
  });
};

export const createSphereCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    colliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    colliderWorker.postMessage({ type: COLLIDER_TYPE.SPHERE, params });
  });
};

export const createBoxCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    colliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    colliderWorker.postMessage({ type: COLLIDER_TYPE.BOX, params });
  });
};

export const createTrimeshCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    const position = mesh.geometry.attributes.position.array;
    const index = mesh.geometry.index ? mesh.geometry.index.array : null;

    colliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      positions: Array.from(position),
      index: index ? Array.from(index) : null,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    };

    colliderWorker.postMessage({ type: COLLIDER_TYPE.TRIMESH, params });
  });
};
