import { PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevContext } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { getVertexData, getVertexDataRaw, getVertexSample } from "../world/terrain/vertexData";
import { useInput } from "./useInput";
import { getAssignedSpawnOffset } from "../net/connection";
import {
  createCharacter,
  createStepResult,
  disposeCharacter,
  resetCharacterMotion,
  stepCharacter,
  type Character,
} from "../physics/characterMovement";

/** BODY-CENTER position; the player free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
const FALL_RESET_Y = -500;

const GROUND_CHECK_INTERVAL = 3; // frames
// Generous: coarse-LOD heightfield colliders legitimately sit a little below the analytic surface.
const BACKSTOP_EMBED_TOLERANCE = 2;

const STUCK_FRAMES_TRIGGER = 12; // ~0.2s of blocked input
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 45; // frames

// Movement feel (slopes, gravity, jump, substepping) is tuned in physics/characterMovement.ts.
const WALK_SPEED = 15;
const SPRINT_SPEED = 45;

const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

const PLAYER_HEIGHT = 2;
const PLAYER_RADIUS = 0.5;
const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

const CAMERA_FAR = 7200;
const CAMERA_LERP = 0.3;

const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

/** Surface height at (x, z) if the capsule bottom is more than `tolerance`
 *  below it, else null. The raw height is only a PRE-FILTER: flatten pads
 *  EXCAVATE (up to 8.3u measured), so trusting it alone teleported players
 *  standing inside a building's excavation every 3 frames. The padded confirm
 *  runs in the dressing worker — a flatten-tile miss is 30–70ms. */
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

  const pointerControlsRef = useRef<PointerLockControlsImpl | null>(null);


  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    const character = characterRef.current;
    if (!rb || !character) return;

    const { forward, backward, left, right, sprint, jump, control } = inputRef.current;

    const dt = Math.min(delta, 0.05);

    camera.getWorldDirection(_direction);
    _direction.y = 0;
    _direction.normalize();
    _side.crossVectors(_up, _direction).normalize();

    _moveVec.set(0, 0, 0);
    if (forward) _moveVec.add(_direction);
    if (backward) _moveVec.sub(_direction);
    if (left) _moveVec.add(_side);
    if (right) _moveVec.sub(_side);

    const pos = rb.translation();

    // Hold at spawn until the ground exists. The server's spawn offset is applied
    // here, not via the RigidBody position prop: it can change on reconnect and
    // must never teleport a player who has already landed.
    if (!terrainLoaded && !noclip) {
      const off = getAssignedSpawnOffset();
      const sx = spawn[0] + (off?.x ?? 0);
      const sz = spawn[2] + (off?.z ?? 0);
      rb.setTranslation({ x: sx, y: spawn[1], z: sz }, true);
      character.state.vy = 0;
      _camTarget.set(sx, spawn[1] + PLAYER_HEIGHT * 0.5, sz);
      camera.position.copy(_camTarget);
      cameraReady.current = false;
      return;
    }

    if (noclip) {
      const hSpeed = sprint ? DEV_SPRINT_SPEED : DEV_SPEED;
      const vSpeed = sprint ? DEV_VERTICAL_SPRINT_SPEED : DEV_VERTICAL_SPEED;

      if (_moveVec.lengthSq() > 0) {
        _moveVec.normalize().multiplyScalar(hSpeed);
      }

      let vy = 0;
      if (jump) vy += vSpeed;
      if (control) vy -= vSpeed;

      rb.setTranslation({ x: pos.x + _moveVec.x * dt, y: pos.y + vy * dt, z: pos.z + _moveVec.z * dt }, true);
    } else {
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
      const collider = rb.collider(0);
      if (collider) {
        const r = stepCharacter(
          world,
          character,
          rb,
          collider,
          pos.x,
          pos.y,
          pos.z,
          { dirX: _moveVec.x, dirZ: _moveVec.z, speed, jump },
          dt,
          stepResult
        );

        // Stuck escape: a capsule slightly embedded (under the backstop tolerance,
        // e.g. after a LOD swap) makes every sweep return ~zero. Signal = sustained
        // input with ~no movement; confirmed against the analytic height so a wall
        // push never triggers it.
        const wantSq = r.desiredX * r.desiredX + r.desiredZ * r.desiredZ;
        const gotX = r.x - pos.x;
        const gotZ = r.z - pos.z;
        const gotSq = gotX * gotX + gotZ * gotZ;
        if (wantSq > 1e-6 && gotSq < wantSq * 0.0025) {
          stuckFrames.current++;
        } else {
          stuckFrames.current = 0;
        }
        if (
          stuckFrames.current >= STUCK_FRAMES_TRIGGER &&
          !unsticking.current &&
          terrainLoaded &&
          !respawning.current
        ) {
          unsticking.current = true;
          const sx = r.x;
          const sz = r.z;
          resolveEmbeddedSurface(sx, sz, r.y - PLAYER_HEIGHT / 2, STUCK_EMBED_MIN).then((surface) => {
            unsticking.current = false;
            const body = rigidBodyRef.current;
            if (!body) return;
            const cur = body.translation();
            if (Math.abs(cur.x - sx) > 3 || Math.abs(cur.z - sz) > 3) return; // stale
            if (surface !== null && cur.y - PLAYER_HEIGHT / 2 < surface - STUCK_EMBED_MIN) {
              body.setTranslation({ x: cur.x, y: surface + PLAYER_HEIGHT / 2 + 0.1, z: cur.z }, true);
              resetCharacterMotion(character.state);
              stuckFrames.current = 0;
            } else {
              stuckFrames.current = -STUCK_RECHECK_BACKOFF;
            }
          });
        }
      }
    }

    const finalPos = rb.translation();

    // Authoritative anti-tunneling backstop: heightfield colliders swap during
    // LOD changes, so sweep hardening alone can't close every timing hole.
    if (!noclip && terrainLoaded && !respawning.current) {
      groundCheckFrame.current++;
      if (groundCheckFrame.current % GROUND_CHECK_INTERVAL === 0) {
        const cx = finalPos.x;
        const cz = finalPos.z;
        resolveEmbeddedSurface(cx, cz, finalPos.y - PLAYER_HEIGHT / 2, BACKSTOP_EMBED_TOLERANCE).then((surface) => {
          if (surface === null) return;
          const body = rigidBodyRef.current;
          if (!body) return;
          const cur = body.translation();
          if (Math.abs(cur.x - cx) > 3 || Math.abs(cur.z - cz) > 3) return; // stale
          if (cur.y - PLAYER_HEIGHT / 2 >= surface - BACKSTOP_EMBED_TOLERANCE) return;
          body.setTranslation({ x: cur.x, y: surface + PLAYER_HEIGHT / 2 + 0.1, z: cur.z }, true);
          resetCharacterMotion(character.state);
        });
      }
    }

    if (finalPos.y < FALL_RESET_Y && !respawning.current) {
      respawning.current = true;
      character.state.vy = 0;
      getVertexData(finalPos.x, finalPos.z).then((vd) => {
        if (rigidBodyRef.current) {
          rigidBodyRef.current.setTranslation({ x: finalPos.x, y: vd.height + 10, z: finalPos.z }, true);
        }
        character.state.vy = 0;
        respawning.current = false;
      });
    }

    _camTarget.set(finalPos.x, finalPos.y + PLAYER_HEIGHT * 0.5, finalPos.z);

    if (!cameraReady.current) {
      camera.position.copy(_camTarget);
      cameraReady.current = true;
    } else {
      camera.position.lerp(_camTarget, CAMERA_LERP);
    }

    playerPosition.set(finalPos.x, finalPos.y, finalPos.z);
  }, -3);

  return (
    <>
      <PointerLockControls ref={pointerControlsRef} />
      <RigidBody ref={rigidBodyRef} type="kinematicPosition" position={spawn} colliders={false} ccd>
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} />
      </RigidBody>
    </>
  );
};
