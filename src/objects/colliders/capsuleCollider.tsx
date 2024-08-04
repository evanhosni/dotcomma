import { useCylinder, useSphere } from "@react-three/cannon";
import * as THREE from "three";

export const createCapsuleCollider = (mesh: THREE.Mesh) => {
  const boundingBox = new THREE.Box3();
  const boundingSphere = new THREE.Sphere();

  mesh.geometry.computeBoundingBox();
  boundingBox.copy(mesh.geometry.boundingBox!);

  mesh.geometry.computeBoundingSphere();
  boundingSphere.copy(mesh.geometry.boundingSphere!);

  const scale = mesh.scale.clone();
  const size = new THREE.Vector3();
  boundingBox.getSize(size);
  size.multiply(scale);

  const radius = boundingSphere.radius * Math.max(scale.x, scale.y, scale.z);
  const height = Math.abs(size.y - 2 * radius);

  return {
    radius,
    height,
    position: mesh.position.clone(),
    rotation: mesh.rotation.clone(),
  };
};

export const CapsuleCollider = ({
  radius,
  height,
  position,
  offset,
  rotation,
}: {
  radius: number;
  height: number;
  position: THREE.Vector3;
  offset: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
}) => {
  const halfHeight = height / 2;

  const [sphere1Ref] = useSphere(() => ({
    args: [radius],
    position: [position.x + offset[0], position.y + offset[1] + halfHeight, position.z + offset[2]],
    rotation: rotation,
  }));

  const [sphere2Ref] = useSphere(() => ({
    args: [radius],
    position: [position.x + offset[0], position.y + offset[1] - halfHeight, position.z + offset[2]],
    rotation: rotation,
  }));

  const [cylinderRef] = useCylinder(() => ({
    args: [radius, radius, Math.abs(height), 8],
    position: [position.x + offset[0], position.y + offset[1], position.z + offset[2]],
    rotation: rotation,
  }));

  return (
    <group>
      <mesh ref={sphere1Ref as any} />
      <mesh ref={sphere2Ref as any} />
      <mesh ref={cylinderRef as any} />
    </group>
  );
};
