import { useTrimesh } from "@react-three/cannon";
import * as THREE from "three";
import { COLLIDER_TYPE } from "./colliderWorker";

export const trimeshColliderWorker = new Worker(new URL("./colliderWorker.ts", import.meta.url), {
  type: "module",
});

export const createTrimeshCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    const position = mesh.geometry.attributes.position.array;
    const index = mesh.geometry.index ? mesh.geometry.index.array : null;

    trimeshColliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      positions: Array.from(position),
      index: index ? Array.from(index) : null,
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
    };

    trimeshColliderWorker.postMessage({ type: COLLIDER_TYPE.TRIMESH, params });
  });
};

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  rotation,
  offset,
}: {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  offset: THREE.Vector3Tuple;
}) => {
  const [ref] = useTrimesh(() => ({
    args: [vertices, indices],
    position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
    rotation,
  }));

  return <mesh ref={ref as any} />;
};
