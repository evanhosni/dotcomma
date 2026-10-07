import * as THREE from "three";
import { GLTF } from "three/examples/jsm/loaders/GLTFLoader";
import { createWorkerClient } from "../../../utils/workers/workerClient";
import { COLLIDER_TYPE, ColliderWorkerMessage, ModelColliders, WholeTrimeshWorkerMessage } from "./types";

// Domain-agnostic, so never reset on a domain switch; no INIT handshake.
const colliderClient = createWorkerClient({
  create: () => new Worker(new URL("./collider.worker.ts", import.meta.url), { type: "module" }),
});

const colliderCache = new Map<string, Promise<ModelColliders>>();

/** The GLTF custom properties a top-level mesh is tagged with, in precedence order (each equals its userData key). */
const TAGGED_TYPES = [COLLIDER_TYPE.CAPSULE, COLLIDER_TYPE.SPHERE, COLLIDER_TYPE.BOX, COLLIDER_TYPE.TRIMESH] as const;
type TaggedType = (typeof TAGGED_TYPES)[number];

const collidersOfType = (colliders: ModelColliders, type: TaggedType): unknown[] => {
  switch (type) {
    case COLLIDER_TYPE.CAPSULE:
      return colliders.capsuleColliders;
    case COLLIDER_TYPE.SPHERE:
      return colliders.sphereColliders;
    case COLLIDER_TYPE.BOX:
      return colliders.boxColliders;
    case COLLIDER_TYPE.TRIMESH:
      return colliders.trimeshColliders;
  }
};

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

/** `wholeTrimesh`: one trimesh over every mesh of the model (minus `excludeNames`) instead of the tagged shapes. */
const fitColliders = async (
  gltf: GLTF,
  scale: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple,
  wholeTrimesh: boolean,
  excludeNames?: string[],
): Promise<ModelColliders> => {
  const colliders: ModelColliders = { capsuleColliders: [], sphereColliders: [], boxColliders: [], trimeshColliders: [] };

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
      colliders.trimeshColliders.push(await postToWorker({ type: COLLIDER_TYPE.WHOLE_TRIMESH, meshes }));
    }
    return colliders;
  }

  for (const child of gltf.scene.children) {
    if (!(child instanceof THREE.Mesh) || !child.geometry) continue;
    const type = TAGGED_TYPES.find((t) => child.userData[t]);
    if (!type) continue;

    const matrix = buildCombinedMatrix(child, sceneWorldInverse, scale, rotation);
    const msg: ColliderWorkerMessage = {
      type,
      positions: getPositionArray(child.geometry),
      index: getIndexArray(child.geometry),
      matrixElements: Array.from(matrix.elements),
    };
    collidersOfType(colliders, type).push(await postToWorker(msg));
  }
  return colliders;
};

/** Cached per model + scale + rotation + options (only when `modelUrl` is given). */
export const createColliders = (
  gltf: GLTF,
  scale: THREE.Vector3Tuple,
  rotation: THREE.Vector3Tuple,
  wholeTrimesh = false,
  modelUrl?: string,
  excludeNames?: string[],
): Promise<ModelColliders> => {
  const cacheKey = buildCacheKey(modelUrl, scale, rotation, wholeTrimesh, excludeNames);
  const cached = cacheKey ? colliderCache.get(cacheKey) : undefined;
  if (cached) return cached;

  const result = fitColliders(gltf, scale, rotation, wholeTrimesh, excludeNames);
  if (cacheKey) colliderCache.set(cacheKey, result);
  return result;
};
