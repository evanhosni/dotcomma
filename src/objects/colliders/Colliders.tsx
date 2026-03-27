import { RigidBody, CapsuleCollider as RapierCapsule, BallCollider, CuboidCollider, TrimeshCollider as RapierTrimesh } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import type { RapierRigidBody } from "@react-three/rapier";

// NOTE: The RigidBody `position` prop is in LOCAL space (affected by parent
// Three.js group transforms). Since these colliders are rendered inside a
// `<group position={coordinates}>`, we use only the worker-computed offset
// for the position prop. The `setNextKinematicTranslation` API uses WORLD
// coordinates, so kinematic updates add positionRef (= world position).

export const CapsuleCollider = ({
  radius,
  height,
  position,
  positionRef,
  isStatic = true,
}: {
  radius: number;
  height: number;
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  isStatic?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!isStatic && positionRef.current && rigidBodyRef.current) {
      rigidBodyRef.current.setNextKinematicTranslation({
        x: positionRef.current.x + position[0],
        y: positionRef.current.y + position[1],
        z: positionRef.current.z + position[2],
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <RapierCapsule args={[height / 2, radius]} />
    </RigidBody>
  );
};

export const SphereCollider = ({
  radius,
  position,
  positionRef,
  isStatic = true,
}: {
  radius: number;
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  isStatic?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!isStatic && positionRef.current && rigidBodyRef.current) {
      rigidBodyRef.current.setNextKinematicTranslation({
        x: positionRef.current.x + position[0],
        y: positionRef.current.y + position[1],
        z: positionRef.current.z + position[2],
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <BallCollider args={[radius]} />
    </RigidBody>
  );
};

export const BoxCollider = ({
  size,
  position,
  rotation,
  positionRef,
  isStatic = true,
}: {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  isStatic?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!isStatic && positionRef.current && rigidBodyRef.current) {
      rigidBodyRef.current.setNextKinematicTranslation({
        x: positionRef.current.x + position[0],
        y: positionRef.current.y + position[1],
        z: positionRef.current.z + position[2],
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
    </RigidBody>
  );
};

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  rotation,
  positionRef,
  isStatic = true,
}: {
  vertices: number[];
  indices: number[];
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  isStatic?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  useFrame(() => {
    if (!isStatic && positionRef.current && rigidBodyRef.current) {
      rigidBodyRef.current.setNextKinematicTranslation({
        x: positionRef.current.x + position[0],
        y: positionRef.current.y + position[1],
        z: positionRef.current.z + position[2],
      });
    }
  });

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <RapierTrimesh args={[new Float32Array(vertices || []), new Uint32Array(indices || [])]} />
    </RigidBody>
  );
};
