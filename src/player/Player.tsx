// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).
import { PointerLockControls } from "@react-three/drei/core/PointerLockControls";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevContext } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { getAssignedSpawnOffset } from "../net/connection";
import { fetchSurfaceModifiers } from "../objects/dressing/dressingWorker";
import { createCharacter, createStepResult, disposeCharacter, stepCharacter, type Character, type SwimInput } from "../physics/characterMovement";
import { createSurfaceSampler } from "../physics/movementModifiers";
import { setCameraWaterDepth, type LiquidLook } from "../vfx/underwater";
import { driveFlashlight, drivePersonalLight, resetPersonalLight } from "../lighting/personalLight";
import { entranceDaylightAt } from "../objects/dressing/underground/undergroundRegistry";
import { stampSnowTrailAlong } from "../objects/dressing/snow-drift/snowTrail";
import { CAMERA_FAR } from "./constants";
import { useGroundSafetyNets } from "./groundSafetyNets";
import { PLAYER_HEIGHT, PLAYER_RADIUS } from "./spec";
import { useUndergroundMode } from "./undergroundMode";
import { type InputState, useInput } from "./useInput";
import { useWaterProbe } from "./waterProbe";

/** BODY-CENTER position; the player free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
/** Held this far above the spawn's ground until the terrain exists, then dropped: a spawn point inside a
 *  building's footprint lands the player on top of it instead of inside its walls. */
const SPAWN_DROP_HEIGHT = 100;

// Movement feel (slopes, gravity, jump, substepping) is tuned in physics/characterMovement.ts.
const WALK_SPEED = 15;
const SPRINT_SPEED = 45;
/** Frames between surface samples on the dressing worker: a drift's edge is metres wide, a sprint covers 4.5u in 6. */
const SURFACE_SAMPLE_INTERVAL = 6;
/** Standing in a pile at least this deep leaves tracks. */
const SNOW_TRACK_MIN_DEPTH = 0.05;
/** The ground safety nets stay off this long after leaving a tunnel. */
const UNDERGROUND_NET_GRACE_SECONDS = 1.5;

const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;
/** Longest frame the movement integrates (a hitch must not launch the capsule through the ground). */
const MAX_STEP_SECONDS = 0.05;

const CAMERA_LERP = 0.3;

const _direction = new THREE.Vector3();
const _flashlightDirection = new THREE.Vector3();
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
  const { noclip, flashlight } = useDevContext();

  const rigidBodyRef = useRef<RapierRigidBody | null>(null);
  const cameraReady = useRef(false);
  const characterRef = useRef<Character | null>(null);
  const stepResult = useRef(createStepResult()).current;
  const { world, rapier } = useRapier();
  const underground = useUndergroundMode();
  // The nets stay suspended for a grace period after a tunnel, so a late or false "outside" never lifts
  // the player from under the mountain onto its summit.
  const safetyNets = useGroundSafetyNets(rigidBodyRef, terrainLoaded, () => underground.isInside() || underground.outsideFor() < UNDERGROUND_NET_GRACE_SECONDS);
  const water = useWaterProbe();
  const swimInput = useRef<SwimInput>({ surfaceY: NaN, jumpPressed: false, viscosity: 1 }).current;
  const jumpWasHeld = useRef(false);
  // The ground under the player (CharacterInput.surface: the snow's drag and traction), sampled on the
  // dressing worker: on this thread the sample would run the height pipeline, and a cold mountain cell
  // costs ~250ms there (physics/DECISIONS.md).
  const surface = useRef(createSurfaceSampler(SURFACE_SAMPLE_INTERVAL, fetchSurfaceModifiers)).current;
  const lastStamp = useRef({ x: Infinity, z: Infinity }).current;

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
      // A teleport or domain switch: the last sample is another place's water, and the player starts outside.
      water.clear();
      underground.reset();
      surface.reset();
      resetPersonalLight();
      setCameraWaterDepth(0);
      return;
    }

    let liquidY = NaN;
    let liquidLook: LiquidLook = "water";
    if (noclip) {
      flyNoclip(rb, pos, input, move, dt);
    } else {
      const collider = rb.collider(0);
      if (collider) {
        const ug = underground.update(rb, pos, input, character, dt);
        const at = rb.translation();
        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        surface.sample(at.x, at.z, at.y - PLAYER_HEIGHT / 2);
        // Inside a tunnel its liquid is the water; outside, the water probe's surface.
        liquidY = ug.liquidY;
        liquidLook = ug.liquidLook;
        const surfaceY = underground.isInside() ? liquidY : water.surfaceOver(at.y - PLAYER_HEIGHT / 2);
        swimInput.surfaceY = surfaceY;
        swimInput.viscosity = underground.isInside() ? ug.liquidViscosity : 1;
        swimInput.jumpPressed = input.jump && !jumpWasHeld.current;
        const characterInput = {
          dirX: ug.holdWalk ? 0 : move.x,
          dirZ: ug.holdWalk ? 0 : move.z,
          speed,
          jump: input.jump,
          swim: Number.isNaN(surfaceY) ? null : swimInput,
          vyOverride: ug.vyOverride,
          ignoreTerrain: ug.ignoreTerrain,
          surface: surface.modifiers,
        };
        const r = stepCharacter(world, character, rb, collider, at.x, at.y, at.z, characterInput, dt, stepResult);
        safetyNets.escapeIfStuck(r, at, character);
        if (surface.modifiers.snowDepth > SNOW_TRACK_MIN_DEPTH && (r.grounded || r.walkableSupport)) stampSnowTrailAlong(lastStamp, r.x, r.z);
      }
    }

    jumpWasHeld.current = input.jump;

    const finalPos = rb.translation();
    // The personal light comes on after a second in the dark (a tunnel out of its entrances' daylight).
    drivePersonalLight(underground.isInside() ? entranceDaylightAt(finalPos.x, finalPos.y + PLAYER_HEIGHT * 0.5, finalPos.z) : 1, dt);
    driveFlashlight(flashlight, camera.getWorldDirection(_flashlightDirection), dt);
    if (!noclip && terrainLoaded) safetyNets.runBackstop(finalPos, character);
    safetyNets.respawnIfFallen(finalPos, character);
    followWithCamera(finalPos);
    playerPosition.set(finalPos.x, finalPos.y, finalPos.z);
    water.sample(finalPos.x, finalPos.z);
    const cameraSurface = underground.isInside() ? liquidY : water.surfaceOver(camera.position.y);
    setCameraWaterDepth(Number.isNaN(cameraSurface) ? 0 : cameraSurface - camera.position.y, underground.isInside() ? liquidLook : "water");
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
