import * as THREE from "three";
import { TaskQueue } from "../../_/TaskQueue";
/* eslint no-restricted-globals: off */

export enum COLLIDER_TYPE {
  CAPSULE = "capsule",
  SPHERE = "sphere",
  BOX = "box",
  CONVEX = "convex",
  TRIMESH = "trimesh",
}

interface MessageData {
  type: COLLIDER_TYPE;
  params: CapsuleColliderParams | SphereColliderParams | BoxColliderParams | TrimeshColliderParams;
}

interface CapsuleColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

interface SphereColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

interface BoxColliderParams {
  geometry: any;
  position: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

interface TrimeshColliderParams {
  positions: number[];
  index: number[] | null;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  scale: THREE.Vector3Tuple;
}

interface CapsuleColliderProps {
  radius: number;
  height: number;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

interface SphereColliderProps {
  radius: number;
  position: THREE.Vector3Tuple;
}

interface BoxColliderProps {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

interface TrimeshColliderProps {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}

const taskQueue = new TaskQueue();

self.onmessage = function (event: MessageEvent<MessageData>) {
  taskQueue.addTask(() => handleTask(event.data));
};

async function handleTask(task: MessageData) {
  const { type, params } = task;

  if (type === COLLIDER_TYPE.CAPSULE) {
    const { geometry, scale, position, rotation } = params as CapsuleColliderParams;

    const boundingBox = new THREE.Box3();
    const boundingSphere = new THREE.Sphere();
    const bufferGeometry = new THREE.BufferGeometryLoader().parse(geometry);

    bufferGeometry.computeBoundingBox();
    boundingBox.copy(bufferGeometry.boundingBox!);

    bufferGeometry.computeBoundingSphere();
    boundingSphere.copy(bufferGeometry.boundingSphere!);

    const meshScale = new THREE.Vector3(scale[0], scale[1], scale[2]);
    const size = new THREE.Vector3();
    boundingBox.getSize(size);
    size.multiply(meshScale);

    const radius = boundingSphere.radius * Math.max(meshScale.x, meshScale.y, meshScale.z);
    const height = Math.abs(size.y - 2 * radius);

    const center = new THREE.Vector3();
    boundingBox.getCenter(center).multiply(meshScale);

    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2])
    );
    center.applyMatrix4(rotationMatrix);

    center.add(new THREE.Vector3(position[0], position[1], position[2]));

    const colliderData: CapsuleColliderProps = {
      radius,
      height,
      position: [center.x, center.y, center.z],
      rotation: [rotation[0], rotation[1], rotation[2]],
    };

    self.postMessage(colliderData);
  }

  if (type === COLLIDER_TYPE.SPHERE) {
    const { geometry, scale, position, rotation } = params as SphereColliderParams;

    const bufferGeometry = new THREE.BufferGeometryLoader().parse(geometry);
    let boundingSphere = new THREE.Sphere();

    const positionAttribute = bufferGeometry.attributes.position;

    if (positionAttribute instanceof THREE.InterleavedBufferAttribute) {
      const tempArray: number[] = [];
      for (let i = 0; i < positionAttribute.count; i++) {
        tempArray.push(positionAttribute.getX(i), positionAttribute.getY(i), positionAttribute.getZ(i));
      }
      const bufferAttribute = new THREE.BufferAttribute(new Float32Array(tempArray), 3);
      bufferGeometry.setAttribute("position", bufferAttribute);
    }

    bufferGeometry.computeBoundingSphere();
    boundingSphere.copy(bufferGeometry.boundingSphere!);

    const meshScale = new THREE.Vector3(scale[0], scale[1], scale[2]);
    const radius = boundingSphere.radius * Math.max(meshScale.x, meshScale.y, meshScale.z);

    const center = boundingSphere.center.clone();
    center.multiply(meshScale);

    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2])
    );
    center.applyMatrix4(rotationMatrix);

    center.add(new THREE.Vector3(position[0], position[1], position[2]));

    const colliderData: SphereColliderProps = {
      radius,
      position: [center.x, center.y, center.z],
    };

    self.postMessage(colliderData);
  }

  if (type === COLLIDER_TYPE.BOX) {
    const { geometry, scale, position, rotation } = params as BoxColliderParams;

    const bufferGeometry = new THREE.BufferGeometryLoader().parse(geometry);
    let boundingBox = new THREE.Box3();

    const positionAttribute = bufferGeometry.attributes.position;

    if (positionAttribute instanceof THREE.InterleavedBufferAttribute) {
      const tempArray: number[] = [];
      for (let i = 0; i < positionAttribute.count; i++) {
        tempArray.push(positionAttribute.getX(i), positionAttribute.getY(i), positionAttribute.getZ(i));
      }
      const bufferAttribute = new THREE.BufferAttribute(new Float32Array(tempArray), 3);
      boundingBox = new THREE.Box3().setFromBufferAttribute(bufferAttribute);
    } else {
      boundingBox = new THREE.Box3().setFromBufferAttribute(positionAttribute);
    }

    const meshScale = new THREE.Vector3(scale[0], scale[1], scale[2]);

    const size = new THREE.Vector3();
    boundingBox.getSize(size).multiply(meshScale);

    const center = new THREE.Vector3();
    boundingBox.getCenter(center).multiply(meshScale);

    const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(rotation[0], rotation[1], rotation[2])
    );
    center.applyMatrix4(rotationMatrix);

    center.add(new THREE.Vector3(position[0], position[1], position[2]));

    //TODO maybe rotation could be better. Currently it only matches rotation.y

    const colliderData: BoxColliderProps = {
      size: [size.x, size.y, size.z],
      position: [center.x, center.y, center.z],
      rotation: [rotation[0], rotation[1], rotation[2]],
    };

    self.postMessage(colliderData);
  }

  if (type === COLLIDER_TYPE.TRIMESH) {
    const { positions, index, position, rotation, scale } = params as TrimeshColliderParams;

    const vertices: number[] = [];
    const indices: number[] = [];

    const scaleMatrix = new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]);

    for (let i = 0; i < positions.length; i += 3) {
      const vertex = new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]);
      vertex.applyMatrix4(scaleMatrix);
      vertices.push(vertex.x, vertex.y, vertex.z);
    }

    if (index) {
      for (let i = 0; i < index.length; i += 3) {
        indices.push(index[i], index[i + 1], index[i + 2]);
      }
    } else {
      for (let i = 0; i < vertices.length / 3; i += 3) {
        indices.push(i, i + 1, i + 2);
      }
    }

    const colliderData: TrimeshColliderProps = {
      vertices,
      indices,
      position: [position[0], position[1], position[2]],
      rotation: [rotation[0], rotation[1], rotation[2]],
    };

    self.postMessage(colliderData);
  }
}
