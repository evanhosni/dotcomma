import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../context/GameContext";

/** Grid line spacing — matches the old chunked terrain's near-player density
 *  (LOD1: 420u chunk / 96 segments = 4.375u). */
const GRID_SPACING = 4.375;
/** Lit wireframe plane size. It follows the camera (snapped to the grid), so
 *  this only needs to cover the visible lit area, not the walkable world. */
const WIRE_SIZE = 700;
const WIRE_SEGMENTS = WIRE_SIZE / GRID_SPACING; // 160 — must divide evenly
/** Black fill / collider extent. Not infinite, but the home world's content
 *  sits within ~50u of the origin; the Player's analytic backstop (height 0
 *  everywhere) catches anyone who somehow walks off the edge. */
const FILL_SIZE = 8400;

/**
 * HomeWorld's entire ground: ONE static plane instead of the streaming chunk
 * terrain system (<World terrain={false}> skips TerrainRenderer — overkill
 * for a perfectly flat world, and its vertex shader's WORLD_WRAP rebasing
 * broke absolute view-space light math on wrapped chunks anyway).
 *
 * Two passes: a black unlit fill plane, and a white wireframe
 * MeshStandardMaterial 0.02u above it. Standard material + zero scene
 * ambient ⇒ the grid is pure black until a point light exists — the
 * CrtMonitor's screen glow is the only one, so the page stays dark until the
 * player clicks in. The wireframe plane follows the camera snapped to
 * GRID_SPACING, so the grid pattern reads as world-anchored while staying
 * one small draw call.
 */
export const HomeGround = () => {
  const { setProgress, setTerrainLoaded } = useGameContext();
  const fillRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);

  // This plane IS the terrain — unblock the Player (it holds in place until
  // terrain_loaded) the moment the ground exists.
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
