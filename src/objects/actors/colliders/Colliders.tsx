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
import type { BoxColliderProps, CapsuleColliderProps, SphereColliderProps, TrimeshColliderProps } from "./types";

// The RigidBody `position` prop is LOCAL (these mount inside a positioned
// group) but setNextKinematicTranslation is WORLD, so kinematic updates add positionRef.

interface ColliderPlacement {
  position: THREE.Vector3Tuple;
  positionRef: React.MutableRefObject<THREE.Vector3>;
  /** Default true: a fixed body. False: a kinematic body following positionRef. */
  collidersNeverMove?: boolean;
}

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

/** The body every GLTF collider shape sits on. */
const ColliderBody = ({
  position,
  rotation,
  positionRef,
  collidersNeverMove = true,
  children,
}: ColliderPlacement & { rotation?: THREE.Vector3Tuple; children: React.ReactNode }) => {
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  return (
    <RigidBody
      ref={rigidBodyRef}
      type={collidersNeverMove ? "fixed" : "kinematicPosition"}
      position={[position[0], position[1], position[2]]}
      rotation={rotation}
      colliders={false}
    >
      {children}
      {!collidersNeverMove && <KinematicUpdater rigidBodyRef={rigidBodyRef} positionRef={positionRef} position={position} />}
    </RigidBody>
  );
};

export const CapsuleCollider = ({ radius, height, position, positionRef, collidersNeverMove }: ColliderPlacement & CapsuleColliderProps) => (
  <ColliderBody position={position} positionRef={positionRef} collidersNeverMove={collidersNeverMove}>
    <RapierCapsule args={[height / 2, radius]} />
  </ColliderBody>
);

export const SphereCollider = ({ radius, position, positionRef, collidersNeverMove }: ColliderPlacement & SphereColliderProps) => (
  <ColliderBody position={position} positionRef={positionRef} collidersNeverMove={collidersNeverMove}>
    <BallCollider args={[radius]} />
  </ColliderBody>
);

export const BoxCollider = ({
  size,
  position,
  rotation,
  positionRef,
  collidersNeverMove,
}: ColliderPlacement & BoxColliderProps) => (
  <ColliderBody position={position} rotation={rotation} positionRef={positionRef} collidersNeverMove={collidersNeverMove}>
    <CuboidCollider args={[size[0] / 2, size[1] / 2, size[2] / 2]} />
  </ColliderBody>
);

export const TrimeshCollider = ({
  vertices,
  indices,
  position,
  rotation,
  positionRef,
  collidersNeverMove,
}: ColliderPlacement & TrimeshColliderProps) => {
  // r-t-r keys the Rapier shape on `args`: a fresh array per render would rebuild the trimesh (full QBVH) on every parent re-render.
  const args = useMemo<[Float32Array, Uint32Array]>(() => [vertices, indices], [vertices, indices]);
  return (
    <ColliderBody position={position} rotation={rotation} positionRef={positionRef} collidersNeverMove={collidersNeverMove}>
      <RapierTrimesh args={args} />
    </ColliderBody>
  );
};
