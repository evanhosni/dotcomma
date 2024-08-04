import { useSphere } from "@react-three/cannon";
import * as THREE from "three";

export const createSphereCollider = (mesh: THREE.Mesh) => {
  const boundingSphere = new THREE.Sphere();
  mesh.geometry.computeBoundingSphere();
  boundingSphere.copy(mesh.geometry.boundingSphere!);

  const scale = mesh.scale.clone();
  const radius = boundingSphere.radius * Math.max(scale.x, scale.y, scale.z);

  return {
    radius,
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
  };
};

export const SphereCollider = ({
  radius,
  position,
  offset,
  rotation,
}: {
  radius: number;
  position: THREE.Vector3;
  offset: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}) => {
  const [ref] = useSphere(() => ({
    args: [radius],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
    rotation: rotation,
  }));

  return <mesh ref={ref as any} />;
};
