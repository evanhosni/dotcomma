import * as THREE from "three";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
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

// Reusable objects to reduce GC in hot path
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
    self.postMessage({ id, data });
  });
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Compute axis-aligned bounding box from raw position array. */
function computeAABB(positions: number[]): { min: THREE.Vector3; max: THREE.Vector3 } {
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

/** Compute bounding sphere from raw position array. */
function computeBSphere(positions: number[]): { center: THREE.Vector3; radius: number } {
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

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleTask(
  task: ColliderWorkerMessage | WholeTrimeshWorkerMessage
): Promise<CapsuleColliderProps | SphereColliderProps | BoxColliderProps | TrimeshColliderProps> {
  const { type } = task;

  if (type === COLLIDER_TYPE.WHOLE_TRIMESH) {
    return handleWholeTrimesh(task as WholeTrimeshWorkerMessage);
  }

  const msg = task as ColliderWorkerMessage;
  _matrix.fromArray(msg.matrix);
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

function handleCapsule(positions: number[]): CapsuleColliderProps {
  // Bounding box for height, bounding sphere for radius
  const { min, max } = computeAABB(positions);
  const bsphere = computeBSphere(positions);

  const maxScale = Math.max(_scale.x, _scale.y, _scale.z);
  const radius = bsphere.radius * maxScale;

  _size.subVectors(max, min).multiply(_scale);
  const height = Math.abs(_size.y - 2 * radius);

  // Transform the local geometry center by the full matrix
  _center.addVectors(min, max).multiplyScalar(0.5);
  _center.applyMatrix4(_matrix);

  return {
    radius,
    height,
    position: [_center.x, _center.y, _center.z],
  };
}

function handleSphere(positions: number[]): SphereColliderProps {
  const bsphere = computeBSphere(positions);

  const maxScale = Math.max(_scale.x, _scale.y, _scale.z);
  const radius = bsphere.radius * maxScale;

  // Transform center by the full matrix
  bsphere.center.applyMatrix4(_matrix);

  return {
    radius,
    position: [bsphere.center.x, bsphere.center.y, bsphere.center.z],
  };
}

function handleBox(positions: number[]): BoxColliderProps {
  const { min, max } = computeAABB(positions);

  // Size = local size * scale from decomposed matrix
  _size.subVectors(max, min).multiply(_scale);

  // Center = local center transformed by the full matrix
  _center.addVectors(min, max).multiplyScalar(0.5);
  _center.applyMatrix4(_matrix);

  // Rotation from decomposed matrix
  _euler.setFromQuaternion(_quaternion);

  return {
    size: [_size.x, _size.y, _size.z],
    position: [_center.x, _center.y, _center.z],
    rotation: [_euler.x, _euler.y, _euler.z],
  };
}

function handleTrimesh(positions: number[], index: number[] | null): TrimeshColliderProps {
  // Transform all vertices by the full combined matrix
  const vertices: number[] = new Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    _vertex.set(positions[i], positions[i + 1], positions[i + 2]);
    _vertex.applyMatrix4(_matrix);
    vertices[i] = _vertex.x;
    vertices[i + 1] = _vertex.y;
    vertices[i + 2] = _vertex.z;
  }

  // Copy or generate indices
  let indices: number[];
  if (index) {
    indices = index;
  } else {
    indices = [];
    for (let i = 0; i < positions.length / 3; i += 3) {
      indices.push(i, i + 1, i + 2);
    }
  }

  return {
    vertices,
    indices,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
}

function handleWholeTrimesh(task: WholeTrimeshWorkerMessage): TrimeshColliderProps {
  const allVertices: number[] = [];
  const allIndices: number[] = [];
  let vertexOffset = 0;

  for (const mesh of task.meshes) {
    const mat = new THREE.Matrix4().fromArray(mesh.matrix);

    // Transform vertices
    for (let i = 0; i < mesh.positions.length; i += 3) {
      _vertex.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]);
      _vertex.applyMatrix4(mat);
      allVertices.push(_vertex.x, _vertex.y, _vertex.z);
    }

    // Re-index with offset
    const vertCount = mesh.positions.length / 3;
    if (mesh.index) {
      for (let i = 0; i < mesh.index.length; i++) {
        allIndices.push(mesh.index[i] + vertexOffset);
      }
    } else {
      for (let i = 0; i < vertCount; i += 3) {
        allIndices.push(i + vertexOffset, i + 1 + vertexOffset, i + 2 + vertexOffset);
      }
    }
    vertexOffset += vertCount;
  }

  return {
    vertices: allVertices,
    indices: allIndices,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
  };
}
