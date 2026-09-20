import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../../../context/GameContext";

const GRID_SPACING = 4.375; // the old LOD1 vertex spacing (420u / 96)
// Only needs to cover the lit area: the wire plane follows the camera snapped to the grid.
const WIRE_SIZE = 700;
const WIRE_SEGMENTS = WIRE_SIZE / GRID_SPACING; // 160 — must divide evenly
// The Player's analytic backstop (height 0 everywhere) catches anyone who walks off it.
const FILL_SIZE = 8400;

/** HomeDomain's ground: a black fill plane + a LIT white wireframe (pure black
 *  until the CRT's point light powers on). This plane IS the terrain, so it
 *  sets terrainLoaded itself. */
export const HomeGround = () => {
  const { setProgress, setTerrainLoaded } = useGameContext();
  const fillRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    setProgress(1);
    setTerrainLoaded(true);
  }, [setProgress, setTerrainLoaded]);

  useFrame(({ camera }) => {
    if (fillRef.current) {
      fillRef.current.position.x = camera.position.x;
      fillRef.current.position.z = camera.position.z;
    }
    if (wireRef.current) {
      wireRef.current.position.x = Math.round(camera.position.x / GRID_SPACING) * GRID_SPACING;
      wireRef.current.position.z = Math.round(camera.position.z / GRID_SPACING) * GRID_SPACING;
    }
  });

  return (
    <>
      <mesh ref={fillRef} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[FILL_SIZE, FILL_SIZE]} />
        <meshBasicMaterial color="#000000" />
      </mesh>
      <mesh ref={wireRef} rotation-x={-Math.PI / 2} position-y={0.02}>
        <planeGeometry args={[WIRE_SIZE, WIRE_SIZE, WIRE_SEGMENTS, WIRE_SEGMENTS]} />
        <meshStandardMaterial color="#ffffff" wireframe />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[FILL_SIZE / 2, 1, FILL_SIZE / 2]} position={[0, -1, 0]} />
      </RigidBody>
    </>
  );
};
