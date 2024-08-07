import { useSphere } from "@react-three/cannon";
import * as THREE from "three";
import { COLLIDER_TYPE } from "./colliderWorker";

export const sphereColliderWorker = new Worker(new URL("./colliderWorker.ts", import.meta.url), {
  type: "module",
});

export const createSphereCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    sphereColliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    sphereColliderWorker.postMessage({ type: COLLIDER_TYPE.SPHERE, params });
  });
};

export const SphereCollider = ({
  radius,
  position,
  offset,
}: {
  radius: number;
  position: THREE.Vector3Tuple;
  offset: THREE.Vector3Tuple;
}) => {
  const [ref] = useSphere(() => ({
    args: [radius],
    position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
  }));

  return <mesh ref={ref as any} />;
};
