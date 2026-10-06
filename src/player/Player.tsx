// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).
import { PointerLockControls } from "@react-three/drei/core/PointerLockControls";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevContext } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { getAssignedSpawnOffset } from "../net/connection";
import { createCharacter, createStepResult, disposeCharacter, stepCharacter, type Character } from "../physics/characterMovement";
import { CAMERA_FAR } from "./constants";
import { useGroundSafetyNets } from "./groundSafetyNets";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import { type InputState, useInput } from "./useInput";

/** BODY-CENTER position; the player free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
/** Held this far above the spawn's ground until the terrain exists, then dropped: a spawn point inside a
 *  building's footprint lands the player on top of it instead of inside its walls. */
const SPAWN_DROP_HEIGHT = 100;

// Movement feel (slopes, gravity, jump, substepping) is tuned in physics/characterMovement.ts.
const WALK_SPEED = 15;
const SPRINT_SPEED = 45;

const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
/** Longest frame the movement integrates (a hitch must not launch the capsule through the ground). */
const MAX_STEP_SECONDS = 0.05;

const CAMERA_LERP = 0.3;

const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

/** The held keys as a horizontal direction from the camera's flattened forward/side (not normalized). */
const readMoveDirection = (camera: THREE.Camera, input: InputState, out: THREE.Vector3): THREE.Vector3 => {
  camera.getWorldDirection(_direction);
  _direction.y = 0;
  _direction.normalize();
  _side.crossVectors(_up, _direction).normalize();
  out.set(0, 0, 0);
  if (input.forward) out.add(_direction);
  if (input.backward) out.sub(_direction);
  if (input.left) out.add(_side);
  if (input.right) out.sub(_side);
  return out;
};

/** Free flight: no collision, no gravity; jump/control rise and sink. */
const flyNoclip = (rb: RapierRigidBody, pos: { x: number; y: number; z: number }, input: InputState, move: THREE.Vector3, dt: number): void => {
  const hSpeed = input.sprint ? DEV_SPRINT_SPEED : DEV_SPEED;
  const vSpeed = input.sprint ? DEV_VERTICAL_SPRINT_SPEED : DEV_VERTICAL_SPEED;
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(hSpeed);
  let vy = 0;
  if (input.jump) vy += vSpeed;
  if (input.control) vy -= vSpeed;
  rb.setTranslation({ x: pos.x + move.x * dt, y: pos.y + vy * dt, z: pos.z + move.z * dt }, true);
};

/** Mounted ONCE by CustomCanvas; persists across domain switches (see CLAUDE.md). */
export const Player = () => {
  const inputRef = useInput();
  const { camera } = useThree();
  const { terrainLoaded, playerPosition, playerSpawn: spawnPosition } = useGameContext();
  const { noclip } = useDevContext();

  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const cameraReady = useRef(false);
  const characterRef = useRef<Character | null>(null);
  const stepResult = useRef(createStepResult()).current;
  const safetyNets = useGroundSafetyNets(rigidBodyRef, terrainLoaded);

  const { world, rapier } = useRapier();

  // The domain's spawn is a feet position; +0.05 keeps the capsule from starting inside the ground.
  const spawn = useMemo<[number, number, number]>(
    () =>
      spawnPosition
        ? [spawnPosition[0], spawnPosition[1] + PLAYER_HEIGHT / 2 + 0.05, spawnPosition[2]]
        : SPAWN_POSITION,
    [spawnPosition?.[0], spawnPosition?.[1], spawnPosition?.[2]]
  );

  useEffect(() => {
    const character = createCharacter(rapier, world, { height: PLAYER_HEIGHT, radius: PLAYER_RADIUS });
    characterRef.current = character;
    return () => {
      disposeCharacter(world, character);
      characterRef.current = null;
    };
  }, [world, rapier]);

  useEffect(() => {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);

  /** Pins the capsule (and camera) at the spawn plus the server's spawn offset until the ground exists.
   *  The offset is applied here, not via the RigidBody position prop: it can change on reconnect and
   *  must never teleport a player who has already landed. */
  const holdAtSpawn = (rb: RapierRigidBody, character: Character): void => {
    const off = getAssignedSpawnOffset();
    const sx = spawn[0] + (off?.x ?? 0);
    const sz = spawn[2] + (off?.z ?? 0);
    const sy = spawn[1] + SPAWN_DROP_HEIGHT;
    rb.setTranslation({ x: sx, y: sy, z: sz }, true);
    character.state.vy = 0;
    _camTarget.set(sx, sy + PLAYER_HEIGHT * 0.5, sz);
    camera.position.copy(_camTarget);
    cameraReady.current = false;
    // Published while holding too: the address bar and terrain streaming follow the spawn, not the last stand.
    playerPosition.set(sx, sy, sz);
  };

  const followWithCamera = (at: { x: number; y: number; z: number }): void => {
    _camTarget.set(at.x, at.y + PLAYER_HEIGHT * 0.5, at.z);
    if (!cameraReady.current) {
      camera.position.copy(_camTarget);
      cameraReady.current = true;
    } else {
      camera.position.lerp(_camTarget, CAMERA_LERP);
    }
  };

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    const character = characterRef.current;
    if (!rb || !character) return;

    const input = inputRef.current;
    const dt = Math.min(delta, MAX_STEP_SECONDS);
    const move = readMoveDirection(camera, input, _moveVec);
    const pos = rb.translation();

    if (!terrainLoaded && !noclip) {
      holdAtSpawn(rb, character);
      return;
    }

    if (noclip) {
      flyNoclip(rb, pos, input, move, dt);
    } else {
      const collider = rb.collider(0);
      if (collider) {
        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        const characterInput = { dirX: move.x, dirZ: move.z, speed, jump: input.jump };
        const r = stepCharacter(world, character, rb, collider, pos.x, pos.y, pos.z, characterInput, dt, stepResult);
        safetyNets.escapeIfStuck(r, pos, character);
      }
    }

    const finalPos = rb.translation();
    if (!noclip && terrainLoaded) safetyNets.runBackstop(finalPos, character);
    safetyNets.respawnIfFallen(finalPos, character);
    followWithCamera(finalPos);
    playerPosition.set(finalPos.x, finalPos.y, finalPos.z);
  }, -3);

  return (
    <>
      <PointerLockControls />
      <RigidBody ref={rigidBodyRef} type="kinematicPosition" position={spawn} colliders={false} ccd>
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} />
      </RigidBody>
    </>
  );
};
