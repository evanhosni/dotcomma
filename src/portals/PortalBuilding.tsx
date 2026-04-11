import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useState } from "react";
import * as THREE from "three";
import { getVertexData } from "../world/getVertexData";
import { Portal } from "./Portal";
import { INDOOR_Y_OFFSET } from "./types";
import { IndoorWorldVisuals, HALF as ROOM_HALF } from "./worlds/IndoorWorld";

// Building near spawn
const BUILDING_X = 50;
const BUILDING_Z = 50;

// Dimensions (player height is ~2)
const BUILDING_WIDTH = 15;
const BUILDING_HEIGHT = 20; // 10× player
const BUILDING_DEPTH = 15;
const WALL_THICKNESS = 0.5;

// Door
const DOOR_WIDTH = 2.4;
const DOOR_HEIGHT = 5;

const BUILDING_COLOR = "#444444";

export const PortalBuilding = () => {
  const [groundY, setGroundY] = useState<number | null>(null);

  useEffect(() => {
    getVertexData(BUILDING_X, BUILDING_Z, true).then((vd) => {
      setGroundY(vd.height);
    });
  }, []);

  if (groundY === null) return null;

  const halfW = BUILDING_WIDTH / 2;
  const halfD = BUILDING_DEPTH / 2;
  const halfH = BUILDING_HEIGHT / 2;

  return (
    <group position={[BUILDING_X, groundY, BUILDING_Z]}>
      {/* ---- Visual meshes ---- */}

      {/* Back wall (Z = +halfD) */}
      <mesh position={[0, halfH, halfD]}>
        <planeGeometry args={[BUILDING_WIDTH, BUILDING_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>

      {/* Left wall (X = -halfW) */}
      <mesh position={[-halfW, halfH, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[BUILDING_DEPTH, BUILDING_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>

      {/* Right wall (X = +halfW) */}
      <mesh position={[halfW, halfH, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[BUILDING_DEPTH, BUILDING_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>

      {/* Roof */}
      <mesh position={[0, BUILDING_HEIGHT, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[BUILDING_WIDTH, BUILDING_DEPTH]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>

      {/* Front wall (Z = -halfD) — with door cutout */}
      {/* Left section of front wall */}
      <mesh position={[-(DOOR_WIDTH / 2 + (halfW - DOOR_WIDTH / 2) / 2), halfH, -halfD]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[halfW - DOOR_WIDTH / 2, BUILDING_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>
      {/* Right section of front wall */}
      <mesh position={[DOOR_WIDTH / 2 + (halfW - DOOR_WIDTH / 2) / 2, halfH, -halfD]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[halfW - DOOR_WIDTH / 2, BUILDING_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>
      {/* Above door */}
      <mesh position={[0, DOOR_HEIGHT + (BUILDING_HEIGHT - DOOR_HEIGHT) / 2, -halfD]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[DOOR_WIDTH, BUILDING_HEIGHT - DOOR_HEIGHT]} />
        <meshStandardMaterial color={BUILDING_COLOR} side={THREE.DoubleSide} />
      </mesh>

      {/* ---- Physics colliders ---- */}

      {/* Back wall */}
      <RigidBody type="fixed" position={[0, halfH, halfD + WALL_THICKNESS / 2]}>
        <CuboidCollider args={[halfW, halfH, WALL_THICKNESS / 2]} />
      </RigidBody>

      {/* Left wall */}
      <RigidBody type="fixed" position={[-halfW - WALL_THICKNESS / 2, halfH, 0]}>
        <CuboidCollider args={[WALL_THICKNESS / 2, halfH, halfD]} />
      </RigidBody>

      {/* Right wall */}
      <RigidBody type="fixed" position={[halfW + WALL_THICKNESS / 2, halfH, 0]}>
        <CuboidCollider args={[WALL_THICKNESS / 2, halfH, halfD]} />
      </RigidBody>

      {/* Roof */}
      <RigidBody type="fixed" position={[0, BUILDING_HEIGHT + WALL_THICKNESS / 2, 0]}>
        <CuboidCollider args={[halfW, WALL_THICKNESS / 2, halfD]} />
      </RigidBody>

      {/* Front wall — left of door */}
      <RigidBody type="fixed" position={[-(DOOR_WIDTH / 2 + (halfW - DOOR_WIDTH / 2) / 2), halfH, -halfD - WALL_THICKNESS / 2]}>
        <CuboidCollider args={[(halfW - DOOR_WIDTH / 2) / 2, halfH, WALL_THICKNESS / 2]} />
      </RigidBody>

      {/* Front wall — right of door */}
      <RigidBody type="fixed" position={[DOOR_WIDTH / 2 + (halfW - DOOR_WIDTH / 2) / 2, halfH, -halfD - WALL_THICKNESS / 2]}>
        <CuboidCollider args={[(halfW - DOOR_WIDTH / 2) / 2, halfH, WALL_THICKNESS / 2]} />
      </RigidBody>

      {/* Front wall — above door */}
      <RigidBody type="fixed" position={[0, DOOR_HEIGHT + (BUILDING_HEIGHT - DOOR_HEIGHT) / 2, -halfD - WALL_THICKNESS / 2]}>
        <CuboidCollider args={[DOOR_WIDTH / 2, (BUILDING_HEIGHT - DOOR_HEIGHT) / 2, WALL_THICKNESS / 2]} />
      </RigidBody>

      {/* ---- Portal in door opening ---- */}
      <Portal
        id="outdoor-to-indoor"
        pairedId="indoor-to-outdoor"
        position={[0, DOOR_HEIGHT / 2, -halfD]}
        rotation={[0, Math.PI, 0]}
        size={[DOOR_WIDTH, DOOR_HEIGHT]}
        targetIndoorId="indoor-world"
        activationDistance={50}
        direction="enter"
      />

      {/* ---- Always-mounted indoor world visuals at Y offset ---- */}
      <IndoorWorldVisuals position={[0, INDOOR_Y_OFFSET - groundY, -halfD + ROOM_HALF]} />
    </group>
  );
};
