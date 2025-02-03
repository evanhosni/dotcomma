import { useBox, useCylinder, useSphere, useTrimesh } from "@react-three/cannon";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

export const CapsuleCollider = ({
  radius,
  height,
  position,
  positionRef,
}: {
  radius: number;
  height: number;
  position: THREE.Vector3;
  positionRef: React.MutableRefObject<THREE.Vector3>;
}) => {
  const halfHeight = height / 2;

  const [ref1, sphere1Api] = useSphere(() => ({
    args: [radius],
    position: [
      positionRef.current.x + position.x,
      positionRef.current.y + position.y + halfHeight,
      positionRef.current.z + position.z,
    ],
  }));

  const [ref2, sphere2Api] = useSphere(() => ({
    args: [radius],
    position: [
      positionRef.current.x + position.x,
      positionRef.current.y + position.y - halfHeight,
      positionRef.current.z + position.z,
    ],
  }));

  const [ref3, cylinderApi] = useCylinder(() => ({
    args: [radius, radius, Math.abs(height), 8],
    position: [
      positionRef.current.x + position.x,
      positionRef.current.y + position.y,
      positionRef.current.z + position.z,
    ],
  }));

  useFrame(() => {
    if (positionRef.current) {
      sphere1Api.position.set(
        positionRef.current.x + position.x,
        positionRef.current.y + position.y + halfHeight,
        positionRef.current.z + position.z
      );
      sphere2Api.position.set(
        positionRef.current.x + position.x,
        positionRef.current.y + position.y - halfHeight,
        positionRef.current.z + position.z
      );
      cylinderApi.position.set(
        positionRef.current.x + position.x,
        positionRef.current.y + position.y,
        positionRef.current.z + position.z
      );
    }
  });

  return (
    <group>
      <mesh ref={ref1 as any} />
      <mesh ref={ref2 as any} />
      <mesh ref={ref3 as any} />
    </group>
  );
};

export const SphereCollider = ({
  radius,
  position,
  positionRef,
}: {
  radius: number;
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
}) => {
  const [ref, api] = useSphere(() => ({
    args: [radius],
    position: [
      positionRef.current.x + position[0],
      positionRef.current.y + position[1],
      positionRef.current.z + position[2],
    ],
  }));

  useFrame(() => {
    if (positionRef.current) {
      api.position.set(
        positionRef.current.x + position[0],
        positionRef.current.y + position[1],
        positionRef.current.z + position[2]
      );
    }
  });

  return <mesh ref={ref as any} />;
};

export const BoxCollider = ({
  size,
  position,
  rotation,
  positionRef,
}: {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
}) => {
  const [ref, api] = useBox(() => ({
    args: size,
    position: [
      positionRef.current.x + position[0],
      positionRef.current.y + position[1],
      positionRef.current.z + position[2],
    ],
    rotation,
  }));

  useFrame(() => {
    if (positionRef.current) {
      api.position.set(
        positionRef.current.x + position[0],
        positionRef.current.y + position[1],
        positionRef.current.z + position[2]
      );
    }
  });

  return <mesh ref={ref as any} />;
};

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  rotation,
  positionRef,
}: {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
}) => {
  const [ref, api] = useTrimesh(() => ({
    args: [vertices || [], indices || []],
    position: [
      positionRef.current.x + position[0],
      positionRef.current.y + position[1],
      positionRef.current.z + position[2],
    ],
    rotation,
  }));

  useFrame(() => {
    if (positionRef.current) {
      api.position.set(
        positionRef.current.x + position[0],
        positionRef.current.y + position[1],
        positionRef.current.z + position[2]
      );
    }
  });

  return <mesh ref={ref as any} />;
};
