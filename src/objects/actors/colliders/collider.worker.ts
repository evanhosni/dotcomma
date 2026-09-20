import * as THREE from "three";
import { TaskQueue } from "../../../utils/task-queue/TaskQueue";
import {
  BoxColliderProps,
  CapsuleColliderProps,
  COLLIDER_TYPE,
  ColliderWorkerMessage,
  SphereColliderProps,
  TrimeshColliderProps,
  WholeTrimeshWorkerMessage,
} from "./types";

const taskQueue = new TaskQueue();

const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _quaternion = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();
const _vertex = new THREE.Vector3();
const _min = new THREE.Vector3();
const _max = new THREE.Vector3();

self.onmessage = function (event: MessageEvent) {
  const { id, ...msg } = event.data;
  taskQueue.addTask(async () => {
    const data = await handleTask(msg);
    const transfer: Transferable[] = [];
    if ("vertices" in data) transfer.push(data.vertices.buffer, data.indices.buffer);
    (self as any).postMessage({ id, data }, transfer);
  });
};

function computeAABB(positions: Float32Array): { min: THREE.Vector3; max: THREE.Vector3 } {
  _min.set(Infinity, Infinity, Infinity);
  _max.set(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < _min.x) _min.x = x;
    if (y < _min.y) _min.y = y;
    if (z < _min.z) _min.z = z;
    if (x > _max.x) _max.x = x;
    if (y > _max.y) _max.y = y;
    if (z > _max.z) _max.z = z;
  }
  return { min: _min.clone(), max: _max.clone() };
}

function computeBSphere(positions: Float32Array): { center: THREE.Vector3; radius: number } {
  const { min, max } = computeAABB(positions);
  const center = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5);
  let maxDistSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - center.x;
    const dy = positions[i + 1] - center.y;
    const dz = positions[i + 2] - center.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq > maxDistSq) maxDistSq = distSq;
  }
  return { center, radius: Math.sqrt(maxDistSq) };
}

async function handleTask(
  task: ColliderWorkerMessage | WholeTrimeshWorkerMessage
): Promise<CapsuleColliderProps | SphereColliderProps | BoxColliderProps | TrimeshColliderProps> {
  const { type } = task;

  if (type === COLLIDER_TYPE.WHOLE_TRIMESH) {
    return handleWholeTrimesh(task as WholeTrimeshWorkerMessage);
  }

  const msg = task as ColliderWorkerMessage;
  _matrix.fromArray(msg.matrixElements);
  _matrix.decompose(_position, _quaternion, _scale);

  switch (type) {
    case COLLIDER_TYPE.CAPSULE:
      return handleCapsule(msg.positions);
    case COLLIDER_TYPE.SPHERE:
      return handleSphere(msg.positions);
    case COLLIDER_TYPE.BOX:
      return handleBox(msg.positions);
    case COLLIDER_TYPE.TRIMESH:
      return handleTrimesh(msg.positions, msg.index);
    default:
      throw new Error(`Unknown collider type: ${type}`);
  }
}

function handleCapsule(positions: Float32Array): CapsuleColliderProps {
  const { min, max } = computeAABB(positions);
  const bsphere = computeBSphere(positions);

  const maxScale = Math.max(_scale.x, _scale.y, _scale.z);
  const radius = bsphere.radius * maxScale;

  _size.subVectors(max, min).multiply(_scale);
  const height = Math.abs(_size.y - 2 * radius);

  _center.addVectors(min, max).multiplyScalar(0.5);
  _center.applyMatrix4(_matrix);

  return {
    radius,
    height,
    position: [_center.x, _center.y, _center.z],
  };
}

function handleSphere(positions: Float32Array): SphereColliderProps {
  const bsphere = computeBSphere(positions);

  const maxScale = Math.max(_scale.x, _scale.y, _scale.z);
  const radius = bsphere.radius * maxScale;

  bsphere.center.applyMatrix4(_matrix);

  return {
    radius,
    position: [bsphere.center.x, bsphere.center.y, bsphere.center.z],
  };
}

function handleBox(positions: Float32Array): BoxColliderProps {
  const { min, max } = computeAABB(positions);

  _size.subVectors(max, min).multiply(_scale);

  _center.addVectors(min, max).multiplyScalar(0.5);
  _center.applyMatrix4(_matrix);

  _euler.setFromQuaternion(_quaternion);

  return {
    size: [_size.x, _size.y, _size.z],
    position: [_center.x, _center.y, _center.z],
    rotation: [_euler.x, _euler.y, _euler.z],
  };
}

const transformInto = (positions: Float32Array, matrix: THREE.Matrix4, out: Float32Array, outOffset: number): void => {
  for (let i = 0; i < positions.length; i += 3) {
    _vertex.set(positions[i], positions[i + 1], positions[i + 2]);
    _vertex.applyMatrix4(matrix);
    out[outOffset + i] = _vertex.x;
    out[outOffset + i + 1] = _vertex.y;
    out[outOffset + i + 2] = _vertex.z;
  }
};

const sequentialIndices = (vertCount: number, base: number, out: Uint32Array, outOffset: number): void => {
  for (let i = 0; i < vertCount; i++) out[outOffset + i] = base + i;
};

function handleTrimesh(positions: Float32Array, index: Uint32Array | null): TrimeshColliderProps {
  const vertices = new Float32Array(positions.length);
  transformInto(positions, _matrix, vertices, 0);

  // The incoming index is already a private copy.
  let indices: Uint32Array;
  if (index) {
    indices = index;
  } else {
    const vertCount = positions.length / 3;
    indices = new Uint32Array(vertCount - (vertCount % 3));
    sequentialIndices(indices.length, 0, indices, 0);
  }

  return { vertices, indices, position: [0, 0, 0], rotation: [0, 0, 0] };
}

function handleWholeTrimesh(task: WholeTrimeshWorkerMessage): TrimeshColliderProps {
  let totalFloats = 0;
  let totalIndices = 0;
  for (const mesh of task.meshes) {
    totalFloats += mesh.positions.length;
    const vertCount = mesh.positions.length / 3;
    totalIndices += mesh.index ? mesh.index.length : vertCount - (vertCount % 3);
  }
  const allVertices = new Float32Array(totalFloats);
  const allIndices = new Uint32Array(totalIndices);

  let floatOffset = 0;
  let indexOffset = 0;
  let vertexOffset = 0;
  const mat = new THREE.Matrix4();
  for (const mesh of task.meshes) {
    mat.fromArray(mesh.matrixElements);
    transformInto(mesh.positions, mat, allVertices, floatOffset);
    floatOffset += mesh.positions.length;

    const vertCount = mesh.positions.length / 3;
    if (mesh.index) {
      for (let i = 0; i < mesh.index.length; i++) allIndices[indexOffset + i] = mesh.index[i] + vertexOffset;
      indexOffset += mesh.index.length;
    } else {
      const n = vertCount - (vertCount % 3);
      sequentialIndices(n, vertexOffset, allIndices, indexOffset);
      indexOffset += n;
    }
    vertexOffset += vertCount;
  }

  return { vertices: allVertices, indices: allIndices, position: [0, 0, 0], rotation: [0, 0, 0] };
}
