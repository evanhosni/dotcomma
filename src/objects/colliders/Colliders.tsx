import { useFrame } from "@react-three/fiber";
import type { RapierRigidBody } from "@react-three/rapier";
import {
  BallCollider,
  CuboidCollider,
  CapsuleCollider as RapierCapsule,
  TrimeshCollider as RapierTrimesh,
  RigidBody,
} from "@react-three/rapier";
import { useRef } from "react";
import * as THREE from "three";

// NOTE: The RigidBody `position` prop is in LOCAL space (affected by parent
// Three.js group transforms). Since these colliders are rendered inside a
// `<group position={coordinates}>`, we use only the worker-computed offset
// for the position prop. The `setNextKinematicTranslation` API uses WORLD
// coordinates, so kinematic updates add positionRef (= world position).

// Shared component for kinematic position updates — only mounted for non-static colliders
const KinematicUpdater = ({
  rigidBodyRef,
  positionRef,
  position,
}: {
  rigidBodyRef: React.RefObject<RapierRigidBody>;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  position: THREE.Vector3Tuple;
}) => {
  const lastX = useRef(NaN);
  const lastY = useRef(NaN);
  const lastZ = useRef(NaN);

  useFrame(() => {
    if (!positionRef.current || !rigidBodyRef.current) return;
    const x = positionRef.current.x + position[0];
    const y = positionRef.current.y + position[1];
    const z = positionRef.current.z + position[2];
    if (x === lastX.current && y === lastY.current && z === lastZ.current) return;
    lastX.current = x;
    lastY.current = y;
    lastZ.current = z;
    rigidBodyRef.current.setNextKinematicTranslation({ x, y, z });
  });

  return null;
};

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

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <RapierCapsule args={[height / 2, radius]} />
      {!isStatic && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
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

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <BallCollider args={[radius]} />
      {!isStatic && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
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

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      {!isStatic && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
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

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <RapierTrimesh args={[new Float32Array(vertices || []), new Uint32Array(indices || [])]} />
      {!isStatic && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};
