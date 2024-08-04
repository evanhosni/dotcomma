import { useTrimesh } from "@react-three/cannon";
import * as THREE from "three";

export const createTrimeshCollider = (mesh: THREE.Mesh) => {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position.array;
  const index = geometry.index ? geometry.index.array : null;
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(mesh.rotation);
  const scaleMatrix = new THREE.Matrix4().makeScale(mesh.scale.x, mesh.scale.y, mesh.scale.z);

  const vertices: number[] = [];
  for (let i = 0; i < position.length; i += 3) {
    const vertex = new THREE.Vector3(position[i], position[i + 1], position[i + 2]);
    vertex.applyMatrix4(scaleMatrix);
    vertex.applyMatrix4(rotationMatrix);
    vertices.push(vertex.x, vertex.y, vertex.z);
  }

  const indices: number[] = [];
  if (index) {
    for (let i = 0; i < index.length; i += 3) {
      indices.push(index[i], index[i + 1], index[i + 2]);
    }
  } else {
    for (let i = 0; i < vertices.length / 3; i += 3) {
      indices.push(i, i + 1, i + 2);
    }
  }

  return {
    vertices,
    indices,
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
  };
};

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  offset,
  rotation,
}: {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3;
  offset: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}) => {
  const [ref] = useTrimesh(() => ({
    args: [vertices, indices],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
    rotation: rotation,
  }));

  return <mesh ref={ref as any} />;
};
