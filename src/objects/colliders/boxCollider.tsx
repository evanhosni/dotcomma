import { useBox } from "@react-three/cannon";
import * as THREE from "three";
import { COLLIDER_TYPE } from "./colliderWorker";

export const boxColliderWorker = new Worker(new URL("./colliderWorker.ts", import.meta.url), {
  type: "module",
});

export const createBoxCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    boxColliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    boxColliderWorker.postMessage({ type: COLLIDER_TYPE.BOX, params });
  });
};

export const BoxCollider = ({
  size,
  position,
  rotation,
  offset,
}: {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  offset: THREE.Vector3Tuple;
}) => {
  const [ref] = useBox(() => ({
    args: size,
    position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
    rotation,
  }));

  return <mesh ref={ref as any} />;
};
