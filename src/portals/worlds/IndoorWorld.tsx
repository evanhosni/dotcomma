import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import { IndoorWorldProps } from "../types";
import { Portal } from "../Portal";
import { INDOOR_Y_OFFSET } from "../types";

export const ROOM_SIZE = 40;
export const HALF = ROOM_SIZE / 2;
const WALL_THICKNESS = 0.5;
export const DOOR_WIDTH = 2.4;
export const DOOR_HEIGHT = 5;

export const RoomVisuals = () => (
  <group>
    {/* Floor — dark gray */}
    <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
      <meshStandardMaterial color="#333333" side={THREE.DoubleSide} />
    </mesh>

    {/* Ceiling — white */}
    <mesh position={[0, ROOM_SIZE, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
      <meshStandardMaterial color="#dddddd" side={THREE.DoubleSide} />
    </mesh>

    {/* Back wall (Z = -HALF) — red */}
    <mesh position={[0, HALF, -HALF]}>
      <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
      <meshStandardMaterial color="#aa3333" side={THREE.DoubleSide} />
    </mesh>

    {/* Left wall (X = -HALF) — blue */}
    <mesh position={[-HALF, HALF, 0]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
      <meshStandardMaterial color="#3333aa" side={THREE.DoubleSide} />
    </mesh>

    {/* Right wall (X = +HALF) — green */}
    <mesh position={[HALF, HALF, 0]} rotation={[0, -Math.PI / 2, 0]}>
      <planeGeometry args={[ROOM_SIZE, ROOM_SIZE]} />
      <meshStandardMaterial color="#33aa33" side={THREE.DoubleSide} />
    </mesh>

    {/* Front wall (Z = +HALF) — yellow, with door opening */}
    <mesh position={[-(DOOR_WIDTH / 2 + (HALF - DOOR_WIDTH / 2) / 2), HALF, HALF]}>
      <planeGeometry args={[HALF - DOOR_WIDTH / 2, ROOM_SIZE]} />
      <meshStandardMaterial color="#aaaa33" side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[DOOR_WIDTH / 2 + (HALF - DOOR_WIDTH / 2) / 2, HALF, HALF]}>
      <planeGeometry args={[HALF - DOOR_WIDTH / 2, ROOM_SIZE]} />
      <meshStandardMaterial color="#aaaa33" side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, DOOR_HEIGHT + (ROOM_SIZE - DOOR_HEIGHT) / 2, HALF]}>
      <planeGeometry args={[DOOR_WIDTH, ROOM_SIZE - DOOR_HEIGHT]} />
      <meshStandardMaterial color="#aaaa33" side={THREE.DoubleSide} />
    </mesh>

    {/* Lighting */}
    <pointLight position={[0, ROOM_SIZE * 0.8, 0]} intensity={200} distance={ROOM_SIZE * 2} />
    <ambientLight intensity={0.3} />
  </group>
);

export const RoomColliders = () => (
  <>
    {/* Floor — extends 1 unit past the front wall so players who land
         behind the exit portal (barely crossed the enter portal) have ground */}
    <RigidBody type="fixed" position={[0, -WALL_THICKNESS / 2, 0]}>
      <CuboidCollider args={[HALF, WALL_THICKNESS / 2, HALF + 1]} />
    </RigidBody>

    {/* Ceiling */}
    <RigidBody type="fixed" position={[0, ROOM_SIZE + WALL_THICKNESS / 2, 0]}>
      <CuboidCollider args={[HALF, WALL_THICKNESS / 2, HALF]} />
    </RigidBody>

    {/* Back wall */}
    <RigidBody type="fixed" position={[0, HALF, -HALF - WALL_THICKNESS / 2]}>
      <CuboidCollider args={[HALF, HALF, WALL_THICKNESS / 2]} />
    </RigidBody>

    {/* Left wall */}
    <RigidBody type="fixed" position={[-HALF - WALL_THICKNESS / 2, HALF, 0]}>
      <CuboidCollider args={[WALL_THICKNESS / 2, HALF, HALF]} />
    </RigidBody>

    {/* Right wall */}
    <RigidBody type="fixed" position={[HALF + WALL_THICKNESS / 2, HALF, 0]}>
      <CuboidCollider args={[WALL_THICKNESS / 2, HALF, HALF]} />
    </RigidBody>

    {/* Front wall — left of door */}
    <RigidBody type="fixed" position={[-(DOOR_WIDTH / 2 + (HALF - DOOR_WIDTH / 2) / 2), HALF, HALF + WALL_THICKNESS / 2]}>
      <CuboidCollider args={[(HALF - DOOR_WIDTH / 2) / 2, HALF, WALL_THICKNESS / 2]} />
    </RigidBody>

    {/* Front wall — right of door */}
    <RigidBody type="fixed" position={[DOOR_WIDTH / 2 + (HALF - DOOR_WIDTH / 2) / 2, HALF, HALF + WALL_THICKNESS / 2]}>
      <CuboidCollider args={[(HALF - DOOR_WIDTH / 2) / 2, HALF, WALL_THICKNESS / 2]} />
    </RigidBody>

    {/* Front wall — above door */}
    <RigidBody type="fixed" position={[0, DOOR_HEIGHT + (ROOM_SIZE - DOOR_HEIGHT) / 2, HALF + WALL_THICKNESS / 2]}>
      <CuboidCollider args={[DOOR_WIDTH / 2, (ROOM_SIZE - DOOR_HEIGHT) / 2, WALL_THICKNESS / 2]} />
    </RigidBody>
  </>
);

/** Always-mounted indoor world visuals + exit portal (no colliders) */
export const IndoorWorldVisuals = ({ position }: { position: [number, number, number] }) => (
  <group position={position} rotation={[0, Math.PI, 0]}>
    <RoomVisuals />
    <Portal
      id="indoor-to-outdoor"
      pairedId="outdoor-to-indoor"
      position={[0, DOOR_HEIGHT / 2, HALF]}
      rotation={[0, Math.PI, 0]}
      size={[DOOR_WIDTH, DOOR_HEIGHT]}
      targetIndoorId="indoor-world"
      activationDistance={50}
      direction="exit"
    />
  </group>
);

/** Active indoor world — colliders only (visuals are always mounted separately) */
export const IndoorWorld = ({ entryPortalPos }: IndoorWorldProps) => {
  const p = entryPortalPos;
  const groupX = p.x;
  const groupY = INDOOR_Y_OFFSET;
  const groupZ = p.z + HALF;

  return (
    <group position={[groupX, groupY, groupZ]} rotation={[0, Math.PI, 0]}>
      <RoomColliders />
    </group>
  );
};
