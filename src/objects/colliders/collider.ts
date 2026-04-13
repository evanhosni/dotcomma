import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { COLLIDER_TYPE, ColliderWorkerMessage, WholeTrimeshWorkerMessage } from "./types";

export const colliderWorker = new Worker(new URL("./collider.worker.ts", import.meta.url), {
  type: "module",
});

let messageId = 0;
const pendingResolves = new Map<number, (data: any) => void>();

interface ColliderState {
  capsuleColliders: any[];
  sphereColliders: any[];
  boxColliders: any[];
  trimeshColliders: any[];
}

// Cache collider results by model+scale+rotation+wholeTrimesh to avoid redundant worker computations
const colliderCache = new Map<string, Promise<ColliderState>>();

function buildCacheKey(
  modelUrl: string | undefined,
  scale: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple,
  wholeTrimesh: boolean,
  excludeNames?: string[]
): string | null {
  if (!modelUrl) return null;
  const excludeStr = excludeNames ? excludeNames.slice().sort().join(',') : '';
  return `${modelUrl}|${scale[0]},${scale[1]},${scale[2]}|${rotation[0]},${rotation[1]},${rotation[2]}|${wholeTrimesh}|${excludeStr}`;
}

colliderWorker.onmessage = (event) => {
  const { id, data } = event.data;
  const resolve = pendingResolves.get(id);
  if (resolve) {
    pendingResolves.delete(id);
    resolve(data);
  }
};

function postToWorker(msg: any): Promise<any> {
  return new Promise((resolve) => {
    const id = messageId++;
    pendingResolves.set(id, resolve);
    colliderWorker.postMessage({ id, ...msg });
  });
}

/**
 * Extract raw position array from a geometry, handling InterleavedBufferAttribute.
 */
function getPositionArray(geometry: THREE.BufferGeometry): number[] {
  const attr = geometry.attributes.position;
  if (attr instanceof THREE.InterleavedBufferAttribute) {
    const out: number[] = [];
    for (let i = 0; i < attr.count; i++) {
      out.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
    return out;
  }
  return Array.from(attr.array);
}

/**
 * Build the combined transform matrix for a GLTF child mesh.
 * Maps geometry-local vertices to spawn-local coordinates (offset from positionRef).
 *
 * The visual rendering chain is:
 *   <group position={coordinates}>
 *     <primitive object={scene} scale={spawnScale} rotation={spawnRotation}>
 *       ...child meshes (potentially nested)...
 *
 * <primitive> overwrites the scene's own transforms, so we strip the scene's
 * world matrix and replace it with the spawn transforms.
 */
function buildCombinedMatrix(
  child: THREE.Object3D,
  sceneWorldInverse: THREE.Matrix4,
  spawnScale: THREE.Vector3Tuple,
  spawnRotation: THREE.Vector3Tuple
): THREE.Matrix4 {
  const spawnMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(spawnRotation[0], spawnRotation[1], spawnRotation[2])),
    new THREE.Vector3(spawnScale[0], spawnScale[1], spawnScale[2])
  );

  // child.matrixWorld includes the scene root's own transform + all parent
  // transforms down to this child. Premultiplying by sceneWorldInverse strips
  // the scene's transform, leaving only the child-to-scene-root chain.
  const childRelative = child.matrixWorld.clone().premultiply(sceneWorldInverse);

  return spawnMatrix.multiply(childRelative);
}

export const createColliders = async (
  gltf: GLTF,
  scale: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple,
  wholeTrimesh = false,
  modelUrl?: string,
  excludeNames?: string[],
): Promise<ColliderState> => {
  const cacheKey = buildCacheKey(modelUrl, scale, rotation, wholeTrimesh, excludeNames);

  if (cacheKey) {
    const cached = colliderCache.get(cacheKey);
    if (cached) return cached;
  }

  const resultPromise = (async (): Promise<ColliderState> => {
    const capsuleColliders: any[] = [];
    const sphereColliders: any[] = [];
    const boxColliders: any[] = [];
    const trimeshColliders: any[] = [];

    // Force-compute world matrices so we can get child-to-scene transforms
    gltf.scene.updateMatrixWorld(true);
    const sceneWorldInverse = gltf.scene.matrixWorld.clone().invert();

    if (wholeTrimesh) {
      // Collect all mesh geometry into a single trimesh collider
      const meshes: WholeTrimeshWorkerMessage["meshes"] = [];
      const excludeSet = excludeNames ? new Set(excludeNames) : null;

      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.geometry) return;
        if (excludeSet && excludeSet.has(child.name)) return;

        const matrix = buildCombinedMatrix(child, sceneWorldInverse, scale, rotation);
        meshes.push({
          positions: getPositionArray(child.geometry),
          index: child.geometry.index ? Array.from(child.geometry.index.array as ArrayLike<number>) : null,
          matrix: Array.from(matrix.elements),
        });
      });

      if (meshes.length > 0) {
        const result = await postToWorker({
          type: COLLIDER_TYPE.WHOLE_TRIMESH,
          meshes,
        } as WholeTrimeshWorkerMessage);
        trimeshColliders.push(result);
      }

      return { capsuleColliders, sphereColliders, boxColliders, trimeshColliders };
    }

    // Per-child colliders based on userData flags
    for (const child of gltf.scene.children) {
      if (!(child instanceof THREE.Mesh) || !child.geometry) continue;

      let type: COLLIDER_TYPE | null = null;
      if (child.userData.capsule) type = COLLIDER_TYPE.CAPSULE;
      else if (child.userData.sphere) type = COLLIDER_TYPE.SPHERE;
      else if (child.userData.box) type = COLLIDER_TYPE.BOX;
      else if (child.userData.trimesh) type = COLLIDER_TYPE.TRIMESH;
      if (!type) continue;

      const matrix = buildCombinedMatrix(child, sceneWorldInverse, scale, rotation);
      const positions = getPositionArray(child.geometry);
      const index = child.geometry.index ? Array.from(child.geometry.index.array as ArrayLike<number>) : null;

      const msg: ColliderWorkerMessage = {
        type,
        positions,
        index,
        matrix: Array.from(matrix.elements),
      };

      const result = await postToWorker(msg);

      if (type === COLLIDER_TYPE.CAPSULE) capsuleColliders.push(result);
      else if (type === COLLIDER_TYPE.SPHERE) sphereColliders.push(result);
      else if (type === COLLIDER_TYPE.BOX) boxColliders.push(result);
      else if (type === COLLIDER_TYPE.TRIMESH) trimeshColliders.push(result);
    }

    return { capsuleColliders, sphereColliders, boxColliders, trimeshColliders };
  })();

  if (cacheKey) {
    colliderCache.set(cacheKey, resultPromise);
  }

  return resultPromise;
};
