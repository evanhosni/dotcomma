import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevContext } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { getVertexData, getVertexDataRaw, getVertexSample } from "../world/terrain/vertexData";
import { type InputState, useInput } from "./useInput";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import { CAMERA_FAR } from "./constants";
import { getAssignedSpawnOffset } from "../net/connection";
import {
  createCharacter,
  createStepResult,
  disposeCharacter,
  resetCharacterMotion,
  stepCharacter,
  type Character,
  type CharacterMotionState,
  type CharacterStepResult,
} from "../physics/characterMovement";

/** BODY-CENTER position; the player free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
const FALL_RESET_Y = -500;
/** Above the ground after a fall reset. */
const FALL_RESET_DROP_HEIGHT = 10;

const GROUND_CHECK_INTERVAL = 3; // frames
// Generous: coarse-LOD heightfield colliders legitimately sit a little below the analytic surface.
const BACKSTOP_EMBED_TOLERANCE = 2;

const STUCK_FRAMES_TRIGGER = 12; // ~0.2s of blocked input
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 45; // frames
/** "No movement": under 5% of the desired step (0.05²). */
const STUCK_MOVE_FRACTION_SQ = 0.0025;

/** An async height check whose body has since moved this far (either axis) is stale and ignored. */
const STALE_CHECK_DISTANCE = 3;
/** Clearance above the surface when a safety net lifts the capsule onto it. */
const LIFT_CLEARANCE = 0.1;

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

/** Surface height at (x, z) if the capsule bottom is more than `tolerance`
 *  below it, else null. The raw height is only a PRE-FILTER: flatten pads
 *  EXCAVATE (up to ~8u), so trusting it alone would teleport a player standing
 *  in a building's excavation. The padded confirm runs in the dressing worker —
 *  a flatten-tile miss is 30–70ms. */
const resolveEmbeddedSurface = async (
  x: number,
  z: number,
  bottom: number,
  tolerance: number
): Promise<number | null> => {
  const raw = await getVertexDataRaw(x, z);
  if (bottom >= raw.height - tolerance) return null;
  const padded = (await getVertexSample(x, z)) ?? (await getVertexData(x, z));
  if (bottom >= padded.height - tolerance) return null;
  return padded.height;
};

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

/** The check that started at (x, z) no longer applies: the body has moved on. */
const isStale = (cur: { x: number; z: number }, x: number, z: number): boolean =>
  Math.abs(cur.x - x) > STALE_CHECK_DISTANCE || Math.abs(cur.z - z) > STALE_CHECK_DISTANCE;

/** Puts the capsule bottom just above `surface` and clears its fall/slide. */
const liftOnto = (body: RapierRigidBody, cur: { x: number; z: number }, surface: number, motion: CharacterMotionState): void => {
  body.setTranslation({ x: cur.x, y: surface + PLAYER_HEIGHT / 2 + LIFT_CLEARANCE, z: cur.z }, true);
  resetCharacterMotion(motion);
};

/** Mounted ONCE by CustomCanvas; persists across domain switches (see CLAUDE.md). */
export const Player = () => {
  const inputRef = useInput();
  const { camera } = useThree();
  const { terrainLoaded, playerPosition, playerSpawn: spawnPosition } = useGameContext();
  const { noclip } = useDevContext();

  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const cameraReady = useRef(false);
  const respawning = useRef(false);
  const characterRef = useRef<Character | null>(null);
  const stepResult = useRef(createStepResult()).current;
  const groundCheckFrame = useRef(0);
  const stuckFrames = useRef(0);
  const unsticking = useRef(false);

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
    rb.setTranslation({ x: sx, y: spawn[1], z: sz }, true);
    character.state.vy = 0;
    _camTarget.set(sx, spawn[1] + PLAYER_HEIGHT * 0.5, sz);
    camera.position.copy(_camTarget);
    cameraReady.current = false;
    // Published while holding too: the address bar and terrain streaming follow the spawn, not the last stand.
    playerPosition.set(sx, spawn[1], sz);
  };

  /** Stuck escape: a capsule slightly embedded (under the backstop tolerance, e.g. after a LOD swap)
   *  makes every sweep return ~zero. Signal = sustained input with ~no movement; confirmed against the
   *  analytic height so a wall push never triggers it. */
  const escapeIfStuck = (r: CharacterStepResult, from: { x: number; z: number }, character: Character): void => {
    const wantSq = r.desiredX * r.desiredX + r.desiredZ * r.desiredZ;
    const gotX = r.x - from.x;
    const gotZ = r.z - from.z;
    const gotSq = gotX * gotX + gotZ * gotZ;
    if (wantSq > 1e-6 && gotSq < wantSq * STUCK_MOVE_FRACTION_SQ) {
      stuckFrames.current++;
    } else {
      stuckFrames.current = 0;
    }
    if (stuckFrames.current < STUCK_FRAMES_TRIGGER || unsticking.current || !terrainLoaded || respawning.current) return;
    unsticking.current = true;
    const sx = r.x;
    const sz = r.z;
    resolveEmbeddedSurface(sx, sz, r.y - PLAYER_HEIGHT / 2, STUCK_EMBED_MIN).then((surface) => {
      unsticking.current = false;
      const body = rigidBodyRef.current;
      if (!body) return;
      const cur = body.translation();
      if (isStale(cur, sx, sz)) return;
      if (surface !== null && cur.y - PLAYER_HEIGHT / 2 < surface - STUCK_EMBED_MIN) {
        liftOnto(body, cur, surface, character.state);
        stuckFrames.current = 0;
      } else {
        stuckFrames.current = -STUCK_RECHECK_BACKOFF;
      }
    });
  };

  /** Authoritative anti-tunneling backstop, every GROUND_CHECK_INTERVAL frames: heightfield colliders
   *  swap during LOD changes, so sweep hardening alone can't close every timing hole. */
  const runBackstop = (at: { x: number; y: number; z: number }, character: Character): void => {
    groundCheckFrame.current++;
    if (groundCheckFrame.current % GROUND_CHECK_INTERVAL !== 0) return;
    const cx = at.x;
    const cz = at.z;
    resolveEmbeddedSurface(cx, cz, at.y - PLAYER_HEIGHT / 2, BACKSTOP_EMBED_TOLERANCE).then((surface) => {
      if (surface === null) return;
      const body = rigidBodyRef.current;
      if (!body) return;
      const cur = body.translation();
      if (isStale(cur, cx, cz)) return;
      if (cur.y - PLAYER_HEIGHT / 2 >= surface - BACKSTOP_EMBED_TOLERANCE) return;
      liftOnto(body, cur, surface, character.state);
    });
  };

  /** Fell out of the world: drop back in above the ground here. */
  const respawnAfterFall = (at: { x: number; z: number }, character: Character): void => {
    respawning.current = true;
    character.state.vy = 0;
    getVertexData(at.x, at.z).then((vd) => {
      if (rigidBodyRef.current) {
        rigidBodyRef.current.setTranslation({ x: at.x, y: vd.height + FALL_RESET_DROP_HEIGHT, z: at.z }, true);
      }
      character.state.vy = 0;
      respawning.current = false;
    });
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
        escapeIfStuck(r, pos, character);
      }
    }

    const finalPos = rb.translation();
    if (!noclip && terrainLoaded && !respawning.current) runBackstop(finalPos, character);
    if (finalPos.y < FALL_RESET_Y && !respawning.current) respawnAfterFall(finalPos, character);
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
