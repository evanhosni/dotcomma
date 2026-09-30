import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { createWorkerClient } from "../../../utils/workers/workerClient";
import { COLLIDER_TYPE, ColliderWorkerMessage, WholeTrimeshWorkerMessage } from "./types";

// Domain-agnostic, so never reset on a domain switch; no INIT handshake.
const colliderClient = createWorkerClient({
  create: () => new Worker(new URL("./collider.worker.ts", import.meta.url), { type: "module" }),
});

interface ColliderState {
  capsuleColliders: any[];
  sphereColliders: any[];
  boxColliders: any[];
  trimeshColliders: any[];
}

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

const collectTransferables = (msg: ColliderWorkerMessage | WholeTrimeshWorkerMessage): Transferable[] => {
  const out: Transferable[] = [];
  const add = (m: { positions: Float32Array; index: Uint32Array | null }) => {
    out.push(m.positions.buffer);
    if (m.index) out.push(m.index.buffer);
  };
  if (msg.type === COLLIDER_TYPE.WHOLE_TRIMESH) (msg as WholeTrimeshWorkerMessage).meshes.forEach(add);
  else add(msg as ColliderWorkerMessage);
  return out;
};

const postToWorker = (msg: ColliderWorkerMessage | WholeTrimeshWorkerMessage): Promise<any> =>
  colliderClient.request<{ data: any }>(msg as any, collectTransferables(msg)).then((r) => r.data);

/** A COPY, never the live buffer: transferring the shared GLTF buffer would detach it from the renderer. */
function getPositionArray(geometry: THREE.BufferGeometry): Float32Array {
  const attr = geometry.attributes.position;
  if (attr instanceof THREE.InterleavedBufferAttribute) {
    const out = new Float32Array(attr.count * 3);
    for (let i = 0; i < attr.count; i++) {
      out[i * 3] = attr.getX(i);
      out[i * 3 + 1] = attr.getY(i);
      out[i * 3 + 2] = attr.getZ(i);
    }
    return out;
  }
  return new Float32Array(attr.array as ArrayLike<number>);
}

const getIndexArray = (geometry: THREE.BufferGeometry): Uint32Array | null =>
  geometry.index ? new Uint32Array(geometry.index.array as ArrayLike<number>) : null;

/** Geometry-local → spawn-local. <primitive> overwrites the scene root's own
 *  transform, so it is stripped here and replaced by the spawn scale/rotation. */
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

    gltf.scene.updateMatrixWorld(true);
    const sceneWorldInverse = gltf.scene.matrixWorld.clone().invert();

    if (wholeTrimesh) {
      const meshes: WholeTrimeshWorkerMessage["meshes"] = [];
      const excludeSet = excludeNames ? new Set(excludeNames) : null;

      gltf.scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || !child.geometry) return;
        if (excludeSet && excludeSet.has(child.name)) return;

        const matrix = buildCombinedMatrix(child, sceneWorldInverse, scale, rotation);
        meshes.push({
          positions: getPositionArray(child.geometry),
          index: getIndexArray(child.geometry),
          matrixElements: Array.from(matrix.elements),
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
      const index = getIndexArray(child.geometry);

      const msg: ColliderWorkerMessage = {
        type,
        positions,
        index,
        matrixElements: Array.from(matrix.elements),
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
