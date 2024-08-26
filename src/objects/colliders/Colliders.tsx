import { useBox, useCylinder, useSphere, useTrimesh } from "@react-three/cannon";
import * as THREE from "three";

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
    args: [vertices || [], indices || []],
    position: [position[0] + offset[0], position[1] + offset[1], position[2] + offset[2]],
    rotation,
  }));

  return <mesh ref={ref as any} />;
};
