import { PointerLockControls } from "@react-three/drei";
import type { PointerLockControls as PointerLockControlsImpl } from "three-stdlib";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevMode } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { getVertexData, getVertexDataRaw, getVertexSample } from "../world/terrain/vertexData";
import { useInput } from "./useInput";
import { getAssignedSpawnOffset } from "../net/connection";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import {
  createCharacter,
  createStepResult,
  disposeCharacter,
  resetCharacterMotion,
  stepCharacter,
  type Character,
} from "../physics/characterMovement";

/** Default spawn: BODY-CENTER position high above the origin — the player
 *  free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
const FALL_RESET_Y = -500;

// Terrain-floor backstop: how often to compare the capsule against the
// analytic terrain height, and how far below the surface counts as
// "inside the terrain" (generous — coarse-LOD heightfield colliders can sit
// slightly below the analytic surface without anything being wrong).
const GROUND_CHECK_INTERVAL = 3; // frames
const EMBED_TOLERANCE = 2;

// Stuck (wedged-in-the-ground) escape: sustained input with ~no resulting
// movement for this many frames triggers an analytic-height check; if the
// capsule is even slightly below the surface it lifts back onto it. The
// backoff keeps the probe cheap while the player pushes against walls.
const STUCK_FRAMES_TRIGGER = 12; // ~0.2s of blocked input
const STUCK_EMBED_MIN = 0.1;
const STUCK_RECHECK_BACKOFF = 45; // frames

// Normal mode speeds
const WALK_SPEED = 15;
const SPRINT_SPEED = 45;
// EVERYTHING about how the capsule moves — contact offset, slope bands and
// the fall-line slide, gravity, jump impulse, substepping, the ground probe —
// lives in physics/characterMovement.ts, the ONE resolver shared with the
// server's NPCs. Tune it there; this file only reads input and owns the
// terrain backstop, stuck escape, respawn and camera.

// Devmode speeds
const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

// Player dimensions: player/spec.ts (shared with RemotePlayers and the server)
const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

// Camera
const CAMERA_FAR = 7200;
const CAMERA_LERP = 0.3;

// Reusable vectors (avoid per-frame allocations)
const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

/**
 * True collider-surface height at (x, z) IF the capsule bottom is genuinely
 * below it by more than `tolerance` — otherwise null (nothing to rescue).
 *
 * The cheap RAW height is only a PRE-FILTER. Flatten pads EXCAVATE: they lerp
 * terrain toward the actor's own ground height, so on the uphill side of a
 * slope the real ground sits BELOW the raw surface — measured up to 8.3u,
 * past EMBED_TOLERANCE on 6% of pads. Trusting raw there made the backstop
 * "rescue" a player standing on perfectly solid ground inside a building's
 * excavation, teleporting them into the air every 3 frames — the infinite
 * bounce when sliding down a slope into a building. Raw runs first (it builds
 * no pad tiles, so the common case stays cheap); only when it claims the
 * player is embedded do we pay for the padded height, whose flatten tiles are
 * CACHED — a tile build once per area, not per query.
 */
const resolveEmbeddedSurface = async (
  x: number,
  z: number,
  bottom: number,
  tolerance: number
): Promise<number | null> => {
  const raw = await getVertexDataRaw(x, z);
  if (bottom >= raw.height - tolerance) return null; // clearly above ground
  // Padded confirm runs in the DRESSING WORKER: a flatten-tile miss inside
  // the padded path is a 30-70ms computation, and paying it here was a
  // main-thread lag spike every time this branch fired near a building on a
  // slope. Falls back to the main-thread path only until the worker is up.
  const padded = (await getVertexSample(x, z)) ?? (await getVertexData(x, z));
  if (bottom >= padded.height - tolerance) return null; // pad excavation, not tunneling
  return padded.height;
};

/** The first-person controller. Mounted ONCE by CustomCanvas and persists
 *  across domain switches; the active domain publishes its spawn through
 *  GameContext (<Domain playerSpawn>), and the outgoing domain resets
 *  terrain_loaded on unmount, so the hold-at-spawn branch below carries the
 *  player to the new domain's spawn until its ground exists. */
export const Player = () => {
  const inputRef = useInput();
  const { camera } = useThree();
  const { terrain_loaded, playerPosition, playerSpawn: spawnPosition } = useGameContext();
  const { noclip } = useDevMode();

  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const cameraReady = useRef(false);
  const respawning = useRef(false);
  // The shared character (controller + probe ray + motion state) — see
  // physics/characterMovement.ts.
  const characterRef = useRef<Character | null>(null);
  const stepResult = useRef(createStepResult()).current;
  const groundCheckFrame = useRef(0);
  const stuckFrames = useRef(0);
  const unsticking = useRef(false);

  const { world, rapier } = useRapier();

  // BODY-CENTER spawn: the domain's spawn is a feet/ground position (+ a hair
  // of clearance so the capsule never starts penetrating; snap-to-ground
  // settles it on the first step), the default is the sky drop.
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

  // Set camera far plane once
  useEffect(() => {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);

  // The canvas — and so the pointer-locked element — persists across domain
  // switches, so the lock simply stays held; nothing to re-request.
  const pointerControlsRef = useRef<PointerLockControlsImpl | null>(null);


  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    const character = characterRef.current;
    if (!rb || !character) return;

    const { forward, backward, left, right, sprint, jump, control } = inputRef.current;

    // Clamp delta to prevent huge jumps after tab-switch or frame spikes
    const dt = Math.min(delta, 0.05);

    // Get camera forward (horizontal only) and side vectors
    camera.getWorldDirection(_direction);
    _direction.y = 0;
    _direction.normalize();
    _side.crossVectors(_up, _direction).normalize();

    // Build horizontal movement vector
    _moveVec.set(0, 0, 0);
    if (forward) _moveVec.add(_direction);
    if (backward) _moveVec.sub(_direction);
    if (left) _moveVec.add(_side);
    if (right) _moveVec.sub(_side);

    const pos = rb.translation();

    // Hold player in place until terrain colliders are loaded. The server's
    // spawn OFFSET (so simultaneous joiners don't stack) is applied HERE, not
    // through the RigidBody position prop — it can change on reconnect, and a
    // prop change must never teleport a player who has already landed.
    if (!terrain_loaded && !noclip) {
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
      // --- DEV MODE ---
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
      // --- NORMAL MODE (the shared character resolver) ---
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

        // ---- Stuck detection (wedged-in-the-ground escape) ----
        // A capsule SLIGHTLY embedded in the terrain (below the backstop's
        // tolerance — e.g. a LOD swap raised the heightfield a hair) makes
        // every sweep start inside the surface and return ~zero: the player
        // is wedged. Signal: sustained input with almost no resulting
        // horizontal movement. Confirmed against the analytic height (so
        // pushing against a building wall — legitimately blocked — never
        // triggers), the fix is lifting exactly to the surface.
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
          terrain_loaded &&
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
              // Not embedded — blocked by a wall or similar. Back off before
              // re-checking so the probe doesn't run every frame while the
              // player leans on a building.
              stuckFrames.current = -STUCK_RECHECK_BACKOFF;
            }
          });
        }
      }
    }

    // Read final position
    const finalPos = rb.translation();

    // ---- Terrain floor (authoritative anti-tunneling backstop) ----
    // The physics ground is per-chunk HEIGHTFIELD colliders that get swapped
    // during LOD changes — no amount of sweep hardening closes every timing
    // hole, so the capsule can still occasionally end up inside the terrain.
    // The analytic height function (computeVertexData — the SAME source the
    // colliders are built from) is the authority: if the capsule bottom is
    // clearly below the surface, put the player back on it. The tolerance is
    // generous (coarse-LOD colliders can legitimately sit a little below the
    // analytic surface); genuine tunneling blows past it within a frame or
    // two.
    if (!noclip && terrain_loaded && !respawning.current) {
      groundCheckFrame.current++;
      if (groundCheckFrame.current % GROUND_CHECK_INTERVAL === 0) {
        const cx = finalPos.x;
        const cz = finalPos.z;
        resolveEmbeddedSurface(cx, cz, finalPos.y - PLAYER_HEIGHT / 2, EMBED_TOLERANCE).then((surface) => {
          if (surface === null) return;
          const body = rigidBodyRef.current;
          if (!body) return;
          const cur = body.translation();
          // Stale sample — the player moved columns between the request and now.
          if (Math.abs(cur.x - cx) > 3 || Math.abs(cur.z - cz) > 3) return;
          if (cur.y - PLAYER_HEIGHT / 2 >= surface - EMBED_TOLERANCE) return; // recovered meanwhile
          body.setTranslation({ x: cur.x, y: surface + PLAYER_HEIGHT / 2 + 0.1, z: cur.z }, true);
          resetCharacterMotion(character.state);
        });
      }
    }

    // Safety net: if player falls through terrain, respawn at ground height + 10
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

    // Update camera position
    _camTarget.set(finalPos.x, finalPos.y + PLAYER_HEIGHT * 0.5, finalPos.z);

    if (!cameraReady.current) {
      camera.position.copy(_camTarget);
      cameraReady.current = true;
    } else {
      camera.position.lerp(_camTarget, CAMERA_LERP);
    }

    // Update shared player position for state machines / other consumers
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
