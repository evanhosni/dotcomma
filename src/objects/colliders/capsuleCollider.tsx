import { useCylinder, useSphere } from "@react-three/cannon";
import * as THREE from "three";
import { COLLIDER_TYPE } from "./colliderWorker";

export const capsuleColliderWorker = new Worker(new URL("./colliderWorker.ts", import.meta.url), {
  type: "module",
});

export const createCapsuleCollider = (mesh: THREE.Mesh): Promise<any> => {
  return new Promise((resolve) => {
    capsuleColliderWorker.onmessage = (event) => {
      resolve(event.data);
    };

    const params = {
      geometry: mesh.geometry.toJSON(),
      position: [mesh.position.x, mesh.position.y, mesh.position.z],
      scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
      rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    };

    capsuleColliderWorker.postMessage({ type: COLLIDER_TYPE.CAPSULE, params });
  });
};

export const CapsuleCollider = ({
  radius,
  height,
  position,
  offset,
}: {
  radius: number;
  height: number;
  position: THREE.Vector3;
  offset: THREE.Vector3Tuple;
}) => {
  const halfHeight = height / 2;

  const [sphere1Ref] = useSphere(() => ({
    args: [radius],
    position: [position.x + offset[0], position.y + offset[1] + halfHeight, position.z + offset[2]],
  }));

  const [sphere2Ref] = useSphere(() => ({
    args: [radius],
    position: [position.x + offset[0], position.y + offset[1] - halfHeight, position.z + offset[2]],
  }));

  const [cylinderRef] = useCylinder(() => ({
    args: [radius, radius, Math.abs(height), 8],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
  }));

  return (
    <group>
      <mesh ref={sphere1Ref as any} />
      <mesh ref={sphere2Ref as any} />
      <mesh ref={cylinderRef as any} />
    </group>
  );
};
