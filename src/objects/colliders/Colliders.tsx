import { useFrame } from "@react-three/fiber";
import type { RapierRigidBody } from "@react-three/rapier";
import {
  BallCollider,
  CuboidCollider,
  CapsuleCollider as RapierCapsule,
  TrimeshCollider as RapierTrimesh,
  RigidBody,
} from "@react-three/rapier";
import { useMemo, useRef } from "react";
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
  // Per-instance scratch — setNextKinematicTranslation copies the values, so
  // reusing one object avoids an {x,y,z} allocation per moving collider per frame
  const scratch = useRef({ x: 0, y: 0, z: 0 }).current;

  useFrame(() => {
    if (!positionRef.current || !rigidBodyRef.current) return;
    const x = positionRef.current.x + position[0];
    const y = positionRef.current.y + position[1];
    const z = positionRef.current.z + position[2];
    if (x === lastX.current && y === lastY.current && z === lastZ.current) return;
    lastX.current = x;
    lastY.current = y;
    lastZ.current = z;
    scratch.x = x;
    scratch.y = y;
    scratch.z = z;
    rigidBodyRef.current.setNextKinematicTranslation(scratch);
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

  // Stable typed arrays: react-three-rapier spreads `args` into the deps that
  // own the Rapier shape, so a FRESH Float32Array/Uint32Array per render
  // removed and recreated the trimesh collider (full QBVH rebuild) on every
  // parent re-render.
  const args = useMemo<[Float32Array, Uint32Array]>(
    () => [new Float32Array(vertices || []), new Uint32Array(indices || [])],
    [vertices, indices],
  );

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={isStatic ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <RapierTrimesh args={args} />
      {!isStatic && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};
