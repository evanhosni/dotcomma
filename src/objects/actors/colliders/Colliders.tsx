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

// The RigidBody `position` prop is LOCAL (these mount inside a positioned
// group) but setNextKinematicTranslation is WORLD, so kinematic updates add positionRef.

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
  collidersNeverMove = true,
}: {
  radius: number;
  height: number;
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  collidersNeverMove?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={collidersNeverMove ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <RapierCapsule args={[height / 2, radius]} />
      {!collidersNeverMove && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};

export const SphereCollider = ({
  radius,
  position,
  positionRef,
  collidersNeverMove = true,
}: {
  radius: number;
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  collidersNeverMove?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={collidersNeverMove ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      colliders={false}
    >
      <BallCollider args={[radius]} />
      {!collidersNeverMove && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};

export const BoxCollider = ({
  size,
  position,
  rotation,
  positionRef,
  collidersNeverMove = true,
}: {
  size: THREE.Vector3Tuple;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  collidersNeverMove?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={collidersNeverMove ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
      {!collidersNeverMove && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  rotation,
  positionRef,
  collidersNeverMove = true,
}: {
  vertices: Float32Array;
  indices: Uint32Array;
  position: THREE.Vector3Tuple;
  rotation: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  collidersNeverMove?: boolean;
}) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);

  // r-t-r keys the Rapier shape on `args`: a fresh array per render rebuilt the trimesh (full QBVH) on every parent re-render.
  const args = useMemo<[Float32Array, Uint32Array]>(() => [vertices, indices], [vertices, indices]);

  return (
    <RigidBody
      ref={rigidBodyRef}
      type={collidersNeverMove ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      <RapierTrimesh args={args} />
      {!collidersNeverMove && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};
