import { PointerLockControls } from "@react-three/drei/core/PointerLockControls";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import type { RapierRigidBody } from "@react-three/rapier";
import { Suspense, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useDevContext, useGameContext } from "../context/hooks";
import { getAssignedSpawnOffset } from "../net";
import { fetchSurfaceModifiers } from "../objects/dressing/worker";
import { createCharacter, createStepResult, disposeCharacter, stepCharacter } from "../physics";
import { CHARACTER_COLLISION_GROUPS, GRAVITY, TERMINAL_VELOCITY } from "../physics/constants";
import type { Character, SwimInput } from "../physics/types";
import { createSurfaceSampler } from "../physics/movement-modifiers";
import { setCameraWaterDepth } from "../vfx/screen-pass/store";
import { driveFlashlight, drivePersonalLight, resetPersonalLight } from "../lighting/personal-light";
import { entranceDaylightAt } from "../world/underground/registry";
import { stampSnowTrailAlong } from "../objects/dressing/snow-drift/store";
import { wrapAngle } from "../utils/math";
import { MAX_HEAD_PITCH } from "../objects/actors/beeble/animations";
import { BEEBLE_SPEC } from "../objects/actors/beeble/spec";
import { ModelActor } from "../objects/actors/model/ModelActor";
import { createMavUnit } from "../objects/actors/mav-unit";
import { warmPrograms } from "../utils/render";
import { BODY_TURN_RATE, CAMERA_FAR, CAMERA_PITCH_MARGIN, FRONT_VIEW_ANGLE, HEADING_FACING_OFFSET, FRONT_VIEW_MAX_PITCH, FRONT_VIEW_RELEASE_ANGLE, FRONT_VIEW_SECONDS, HEAD_TURN_RATE, IN_PLACE_TURN_DONE, IN_PLACE_TURN_RATE, IN_PLACE_TURN_START, MAX_HEAD_TURN, MAX_LOOK_PITCH, PLAYER_CLIPS, PLAYER_MOVING_SPEED, THIRD_PERSON_DISTANCE, THIRD_PERSON_RISE, THIRD_PERSON_SHOULDER, THIRD_PERSON_WALL_MARGIN, CROSSHAIR_AIM_FAR, VIEW_SWITCH_AIM_SHARPNESS, VIEW_SWITCH_MIN_AIM } from "./constants";
import { useGroundSafetyNets, useUndergroundMode, useInput, useReloadGuard, useThirdPersonToggle, useWaterProbe } from "./hooks";
import { PlayerBody } from "./PlayerBody";
import { posePlayerBody } from "./registry";
import { getThirdPersonBodySide, isPlayerHeld, setCameraBoom, setLocalPlayerBody, takePlayerPlacement } from "./store";
import { PLAYER_HEIGHT, PLAYER_RADIUS, playerEyeY, SPAWN_CLEARANCE } from "./spec";
import type { InputState, PlayerActionSample, PlayerBodyState, PlayerPlacement } from "./types";
import { moveHeadingOf, playerAnimationOf } from "./utils";

// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).

/** BODY-CENTER position; the player free-falls onto the terrain once it loads. */
const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
/** The default hold above a COMPUTED spawn's ground until the terrain exists, then dropped: a spawn point
 *  inside a building's footprint lands the player on top of it instead of inside its walls. A spawn's own
 *  drop height (GameContext spawnDropHeight) overrides it: higher starts there and falls to this hold while
 *  the ground loads (entering the overworld), 0 stands the player exactly on the spawn (a domain's own,
 *  hand-placed one). */
const SPAWN_DROP_HEIGHT = 100;

// Movement feel (slopes, gravity, jump, substepping) is tuned in physics/index.ts.
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
const _lookDirection = new THREE.Vector3();
const _headAim = new THREE.Vector3();
const _crosshairTarget = new THREE.Vector3();
const _aimEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _boom = new THREE.Vector3();
const _right = new THREE.Vector3();
/** Look-and-place rounds after a re-aim, for a boom a wall pulled in (the exact solve assumes its full length). */
const WALLED_AIM_ROUNDS = 3;

/** The head's pitch for a look pitch: the whole look range onto the head's, linearly. */
const headPitchOf = (lookPitch: number): number => (MAX_HEAD_PITCH * lookPitch) / MAX_LOOK_PITCH;

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

/** Free flight: no collision, no gravity; jump/C rise and sink. */
const flyNoclip = (rb: RapierRigidBody, pos: { x: number; y: number; z: number }, input: InputState, move: THREE.Vector3, dt: number): void => {
  const hSpeed = input.sprint ? DEV_SPRINT_SPEED : DEV_SPEED;
  const vSpeed = input.sprint ? DEV_VERTICAL_SPRINT_SPEED : DEV_VERTICAL_SPEED;
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(hSpeed);
  let vy = 0;
  if (input.jump) vy += vSpeed;
  if (input.descend) vy -= vSpeed;
  rb.setTranslation({ x: pos.x + move.x * dt, y: pos.y + vy * dt, z: pos.z + move.z * dt }, true);
};

/** Mounted ONCE by CustomCanvas; persists across domain switches (see CLAUDE.md). */
export const Player = () => {
  const inputRef = useInput();
  useReloadGuard();
  const { camera } = useThree();
  const { terrainLoaded, playerPosition, playerSpawn: spawnPosition, spawnDropHeight } = useGameContext();
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
  const swimInput = useRef<SwimInput>({ surfaceY: NaN, jumpPressed: false, liquid: "water" }).current;
  const jumpWasHeld = useRef(false);
  // The ground under the player (CharacterInput.surface: the snow's drag and traction), sampled on the
  // dressing worker: on this thread the sample would run the height pipeline, and a cold mountain cell
  // costs ~250ms there (physics/DECISIONS.md).
  const surface = useRef(createSurfaceSampler(SURFACE_SAMPLE_INTERVAL, fetchSurfaceModifiers)).current;
  const lastStamp = useRef({ x: Infinity, z: Infinity }).current;
  const thirdPerson = useThirdPersonToggle();
  const action = useRef<PlayerActionSample>({ noclip: false, swimming: false, airborne: false, sliding: false, climbing: false, jumped: false, vy: 0, speed: 0, sprint: false, turningInPlace: false, heading: "forward" }).current;
  const body = useRef<PlayerBodyState>({ form: "host", mavHost: "", mavDepth: 0, equipped: "", wounds: [], shots: 0, feetX: 0, feetY: 0, feetZ: 0, yaw: 0, headYaw: undefined, headPitch: undefined, clip: PLAYER_CLIPS.idle, clipSpeed: 1, loop: "repeat", visible: false }).current;
  /** The head the camera follows (eased), and where the body stood last frame (its speed). */
  const pivot = useRef(new THREE.Vector3()).current;
  const lastFeet = useRef({ x: NaN, z: NaN }).current;
  /** The head's front-view rule (driveBody): seconds the mouse has been still (the camera's turn unchanged
   *  since `lastLook`), and whether the head has centered (until the camera is back behind the body or the
   *  player moves). */
  const head = useRef({ mouseStillFor: 0, centered: false, lastLook: new THREE.Quaternion() }).current;
  /** The view the camera was last placed for: a frame whose toggle differs switches views (beginViewSwitch). */
  const placedThirdPerson = useRef(false);
  /** A view switch's state: the point the new crosshair goes on (`aim`), or the look to give back
   *  (`restore`); each view's look when last left, and the look the last switch set (`entered`). */
  const viewSwitch = useRef({
    aim: new THREE.Vector3(),
    restore: null as THREE.Quaternion | null,
    first: new THREE.Quaternion(),
    third: new THREE.Quaternion(),
    entered: new THREE.Quaternion(),
    switched: false,
  }).current;
  const aimRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), [rapier]);
  const boomRay = useMemo(() => new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }), [rapier]);

  // The domain's spawn is a feet position; +0.05 keeps the capsule from starting inside the ground.
  const spawn = useMemo<[number, number, number]>(
    () =>
      spawnPosition
        ? [spawnPosition[0], spawnPosition[1] + PLAYER_HEIGHT / 2 + SPAWN_CLEARANCE, spawnPosition[2]]
        : SPAWN_POSITION,
    [spawnPosition?.[0], spawnPosition?.[1], spawnPosition?.[2]]
  );

  /** The capsule's height while the ground loads; NaN = start over from the spawn's drop height. */
  const holdY = useRef(NaN);
  useEffect(() => {
    if (!terrainLoaded) holdY.current = NaN;
  }, [spawn, spawnDropHeight, terrainLoaded]);

  useEffect(() => {
    const character = createCharacter(rapier, world, { height: PLAYER_HEIGHT, radius: PLAYER_RADIUS });
    characterRef.current = character;
    return () => {
      disposeCharacter(world, character);
      characterRef.current = null;
    };
  }, [world, rapier]);

  useEffect(() => {
    setLocalPlayerBody(body);
    return () => setLocalPlayerBody(null);
  }, [body]);

  useEffect(() => {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);

  // Every player wears a MAV Unit, first drawn mid-intro (or when another player's falls into view): its
  // programs link at load instead (each link blocks ~0.6s in Firefox).
  const scene = useThree((s) => s.scene);
  useEffect(() => warmPrograms(scene, [createMavUnit()]), [scene]);

  /** Holds the capsule (and camera) over the spawn plus the server's spawn offset until the ground exists:
   *  falling from the spawn's drop height, never below the hold (SPAWN_DROP_HEIGHT, or a lower drop height).
   *  The offset is applied here, not via the RigidBody position prop: it can change on reconnect and
   *  must never teleport a player who has already landed. */
  const holdAtSpawn = (rb: RapierRigidBody, character: Character, dt: number): void => {
    // A hand-placed spawn (drop height 0: a <Domain playerSpawn>) is exact: the server's multiplayer spread
    // would put it off its mark.
    const off = spawnDropHeight === 0 ? null : getAssignedSpawnOffset();
    const sx = spawn[0] + (off?.x ?? 0);
    const sz = spawn[2] + (off?.z ?? 0);
    const drop = spawnDropHeight ?? SPAWN_DROP_HEIGHT;
    const lowest = spawn[1] + Math.min(drop, SPAWN_DROP_HEIGHT);
    if (Number.isNaN(holdY.current)) {
      holdY.current = spawn[1] + drop;
      character.state.vy = 0;
    } else if (holdY.current > lowest) {
      character.state.vy = Math.max(character.state.vy + GRAVITY * dt, TERMINAL_VELOCITY);
      holdY.current = Math.max(holdY.current + character.state.vy * dt, lowest);
    }
    if (holdY.current <= lowest) character.state.vy = 0;
    const sy = holdY.current;
    rb.setTranslation({ x: sx, y: sy, z: sz }, true);
    _camTarget.set(sx, playerEyeY(sy), sz);
    camera.position.copy(_camTarget);
    cameraReady.current = false;
    // Published while holding too: the address bar and terrain streaming follow the spawn, not the last stand.
    playerPosition.set(sx, sy, sz);
  };

  /** Eases the head (the eyes) the camera follows and places the camera for the view; on a frame that
   *  switches views, the new camera is aimed (beginViewSwitch, finishViewSwitch). */
  const followWithCamera = (at: { x: number; y: number; z: number }, rb: RapierRigidBody): void => {
    const switching = thirdPerson.current !== placedThirdPerson.current;
    // Read from the old view, before the camera moves.
    if (switching) beginViewSwitch(rb);
    _camTarget.set(at.x, playerEyeY(at.y), at.z);
    // A switch snaps too: no easing left to slide the new camera off its aim.
    if (!cameraReady.current || switching) pivot.copy(_camTarget);
    else pivot.lerp(_camTarget, CAMERA_LERP);
    cameraReady.current = true;
    placedThirdPerson.current = thirdPerson.current;
    if (switching) finishViewSwitch(rb);
    else placeCamera(rb);
  };

  /** THE VIEW SWITCH keeps the crosshair where it was. The new camera is turned so its crosshair passes
   *  through what the old one's was on (its ray's hit; into third person, no nearer than a smooth maximum
   *  with VIEW_SWITCH_MIN_AIM, as no third-person crosshair reaches a point beside the head). When the mouse
   *  has not moved since the last switch, each view instead gets back exactly the look it was left with, so
   *  toggling back and forth never drifts. */
  const beginViewSwitch = (rb: RapierRigidBody): void => {
    const untouched = viewSwitch.switched && camera.quaternion.equals(viewSwitch.entered);
    (placedThirdPerson.current ? viewSwitch.third : viewSwitch.first).copy(camera.quaternion);
    viewSwitch.restore = untouched ? (thirdPerson.current ? viewSwitch.third : viewSwitch.first) : null;
    if (viewSwitch.restore) return;
    crosshairTarget(rb, viewSwitch.aim);
    if (!thirdPerson.current) return;
    const k = VIEW_SWITCH_AIM_SHARPNESS;
    const aimAt = Math.pow(viewSwitch.aim.distanceTo(camera.position) ** k + VIEW_SWITCH_MIN_AIM ** k, 1 / k);
    viewSwitch.aim.copy(camera.position).addScaledVector(camera.getWorldDirection(_lookDirection), aimAt);
  };

  const finishViewSwitch = (rb: RapierRigidBody): void => {
    if (viewSwitch.restore) {
      camera.quaternion.copy(viewSwitch.restore);
      placeCamera(rb);
    } else {
      aimCameraAt(viewSwitch.aim);
      if (!placeCamera(rb)) {
        for (let i = 0; i < WALLED_AIM_ROUNDS; i++) {
          lookAt(viewSwitch.aim);
          placeCamera(rb);
        }
      }
    }
    viewSwitch.entered.copy(camera.quaternion);
    viewSwitch.switched = true;
  };

  /** Turns the camera so that, once placed for the view (at full boom), the crosshair is on `target`.
   *  First person: straight at it from the head. Third person, solved exactly: the boom is -DISTANCE along
   *  the look + SHOULDER along the camera's (horizontal) right + RISE up, so the crosshair passes through the
   *  target when the target's offset from the head, seen from above, is SHOULDER along that right: the yaw
   *  turns by asin(SHOULDER / horizontal distance) off "straight at it", and the pitch follows. */
  const aimCameraAt = (target: THREE.Vector3): void => {
    if (!thirdPerson.current) {
      camera.position.copy(pivot);
      lookAt(target);
      return;
    }
    const shoulder = getThirdPersonBodySide() === "left" ? THIRD_PERSON_SHOULDER : -THIRD_PERSON_SHOULDER;
    const hx = target.x - pivot.x;
    const hz = target.z - pivot.z;
    const h = Math.hypot(hx, hz);
    if (h < 1e-6) return;
    // Too close to fit beside the crosshair line: the nearest the yaw gets.
    const turn = Math.asin(Math.max(-1, Math.min(1, shoulder / h)));
    const yaw = Math.atan2(-hx, -hz) + turn;
    const qx = hx - shoulder * Math.cos(yaw);
    const qz = hz + shoulder * Math.sin(yaw);
    const qy = target.y - pivot.y - THIRD_PERSON_RISE;
    const pitch = Math.max(-MAX_LOOK_PITCH, Math.min(MAX_LOOK_PITCH, Math.atan2(qy, Math.hypot(qx, qz))));
    camera.quaternion.setFromEuler(_aimEuler.set(pitch, yaw, 0));
  };

  /** What the crosshair is on from where the camera is now (the player's own body skipped): its ray's first
   *  hit, or CROSSHAIR_AIM_FAR along it. */
  const crosshairTarget = (rb: RapierRigidBody, out: THREE.Vector3): THREE.Vector3 => {
    camera.getWorldDirection(_lookDirection);
    aimRay.origin.x = camera.position.x;
    aimRay.origin.y = camera.position.y;
    aimRay.origin.z = camera.position.z;
    aimRay.dir.x = _lookDirection.x;
    aimRay.dir.y = _lookDirection.y;
    aimRay.dir.z = _lookDirection.z;
    const hit = world.castRay(aimRay, CROSSHAIR_AIM_FAR, true, rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, rb);
    return out.copy(camera.position).addScaledVector(_lookDirection, hit ? hit.timeOfImpact : CROSSHAIR_AIM_FAR);
  };

  /** Turns the camera to look at `target` from where it is (no roll; the look's pitch clamp kept). */
  const lookAt = (target: THREE.Vector3): void => {
    const dx = target.x - camera.position.x;
    const dy = target.y - camera.position.y;
    const dz = target.z - camera.position.z;
    if (dx * dx + dy * dy + dz * dz < 1e-6) return;
    const pitch = Math.max(-MAX_LOOK_PITCH, Math.min(MAX_LOOK_PITCH, Math.atan2(dy, Math.hypot(dx, dz))));
    camera.quaternion.setFromEuler(_aimEuler.set(pitch, Math.atan2(-dx, -dz), 0));
  };

  /** First person: the camera is the eased head. Third person: it hangs THIRD_PERSON_DISTANCE behind the
   *  head along the look, over the shoulder that leaves the body on its chosen side of the screen, pulled in
   *  front of whatever the boom hits (the player's own body excluded). The boom's length along the look starts
   *  the aim ray (utils.ts). True when the camera is at its full boom (first person: always). */
  const placeCamera = (rb: RapierRigidBody): boolean => {
    if (!thirdPerson.current) {
      camera.position.copy(pivot);
      setCameraBoom(0);
      return true;
    }
    camera.getWorldDirection(_lookDirection);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _boom.copy(_lookDirection).multiplyScalar(-THIRD_PERSON_DISTANCE).addScaledVector(_right, getThirdPersonBodySide() === "left" ? THIRD_PERSON_SHOULDER : -THIRD_PERSON_SHOULDER).addScaledVector(_up, THIRD_PERSON_RISE);
    const length = _boom.length();
    _boom.divideScalar(length);
    boomRay.origin.x = pivot.x;
    boomRay.origin.y = pivot.y;
    boomRay.origin.z = pivot.z;
    boomRay.dir.x = _boom.x;
    boomRay.dir.y = _boom.y;
    boomRay.dir.z = _boom.z;
    const hit = world.castRay(boomRay, length + THIRD_PERSON_WALL_MARGIN, true, undefined, undefined, undefined, rb);
    const reach = hit ? Math.max(hit.timeOfImpact - THIRD_PERSON_WALL_MARGIN, 0) : length;
    camera.position.copy(pivot).addScaledVector(_boom, reach);
    setCameraBoom(-reach * _boom.dot(_lookDirection));
    return !hit;
  };

  /** Where the head looks, as a unit vector into `out`: the camera's look in first person (the camera is at
   *  the eyes); in third person from the eyes to what the crosshair is on (crosshairTarget, cast every
   *  frame), which the camera, behind and beside the head, sees from another angle. */
  const headAimOf = (at: { x: number; y: number; z: number }, rb: RapierRigidBody, out: THREE.Vector3): THREE.Vector3 => {
    if (!thirdPerson.current) return camera.getWorldDirection(out);
    crosshairTarget(rb, _crosshairTarget);
    out.set(_crosshairTarget.x - at.x, _crosshairTarget.y - playerEyeY(at.y), _crosshairTarget.z - at.z);
    return out.lengthSq() > 1e-6 ? out.normalize() : camera.getWorldDirection(out);
  };

  /** Places the body and picks this frame's clip. Moving, the body faces the walk; standing in first person,
   *  the head follows the look and past IN_PLACE_TURN_START the body turns in place after it (the NPCs' way);
   *  standing in third person, it stays put and only the head turns. */
  const driveBody = (at: { x: number; y: number; z: number }, rb: RapierRigidBody, move: THREE.Vector3, dt: number): void => {
    action.speed = Number.isNaN(lastFeet.x) ? 0 : Math.hypot(at.x - lastFeet.x, at.z - lastFeet.z) / Math.max(dt, 1e-4);
    lastFeet.x = at.x;
    lastFeet.z = at.z;

    headAimOf(at, rb, _headAim);
    const lookYaw = Math.atan2(_headAim.x, _headAim.z);
    const moving = move.lengthSq() > 0 && action.speed > PLAYER_MOVING_SPEED;
    if (moving) {
      action.turningInPlace = false;
      // Swimming and flying always face the way they go: their clips have no backward or sideways.
      const facingOffset = action.swimming || action.noclip ? 0 : HEADING_FACING_OFFSET[action.heading];
      body.yaw += wrapAngle(Math.atan2(move.x, move.z) + facingOffset - body.yaw) * (1 - Math.exp(-BODY_TURN_RATE * dt));
    } else if (thirdPerson.current) action.turningInPlace = false;
    else {
      const off = Math.abs(wrapAngle(lookYaw - body.yaw));
      if (off > IN_PLACE_TURN_START) action.turningInPlace = true;
      else if (off < IN_PLACE_TURN_DONE) action.turningInPlace = false;
      if (action.turningInPlace) body.yaw += wrapAngle(lookYaw - body.yaw) * (1 - Math.exp(-IN_PLACE_TURN_RATE * dt));
    }
    playerAnimationOf(action, body);

    const lookFromBody = wrapAngle(lookYaw - body.yaw);
    const lookPitch = Math.asin(Math.max(-1, Math.min(1, _headAim.y)));
    const followYaw = Math.max(-MAX_HEAD_TURN, Math.min(MAX_HEAD_TURN, lookFromBody));
    const headYaw = body.headYaw ?? 0;
    const atFront = Math.abs(lookFromBody) > FRONT_VIEW_ANGLE && Math.abs(lookPitch) <= FRONT_VIEW_MAX_PITCH;
    // Under pointer lock the mouse only ever turns the camera: a camera turned since last frame is a mouse moved.
    head.mouseStillFor = camera.quaternion.equals(head.lastLook) ? head.mouseStillFor + dt : 0;
    head.lastLook.copy(camera.quaternion);
    // Centered, it stays so while the look roams the front and sides, until the camera is back behind the
    // body or the player moves.
    if (moving || Math.abs(lookFromBody) < FRONT_VIEW_RELEASE_ANGLE) head.centered = false;
    if (atFront && head.mouseStillFor >= FRONT_VIEW_SECONDS) head.centered = true;
    const headTarget = head.centered ? 0 : followYaw;
    const headK = 1 - Math.exp(-HEAD_TURN_RATE * dt);
    body.headYaw = headYaw + (headTarget - headYaw) * headK;
    // The look's own tilt, scaled onto the head's range (centered with the yaw).
    const pitchTarget = head.centered ? 0 : headPitchOf(lookPitch);
    const headPitch = body.headPitch ?? 0;
    body.headPitch = headPitch + (pitchTarget - headPitch) * headK;
    body.feetX = at.x;
    body.feetY = at.y - PLAYER_HEIGHT / 2;
    body.feetZ = at.z;
    body.visible = thirdPerson.current;
  };

  /** Stands the player where a cutscene left it (store.ts placePlayer), facing its yaw, the camera level
   *  behind the eyes. A spawn not yet loaded still holds it (holdAtSpawn) until the ground exists. */
  const takePlacement = (rb: RapierRigidBody, character: Character, placed: PlayerPlacement): void => {
    rb.setTranslation({ x: placed.x, y: placed.feetY + PLAYER_HEIGHT / 2 + SPAWN_CLEARANCE, z: placed.z }, true);
    character.state.vy = 0;
    body.yaw = placed.yaw;
    body.headYaw = undefined;
    body.headPitch = undefined;
    // The camera looks down its −z: facing the body's forward (sin yaw, cos yaw) is a yaw of π past it.
    camera.quaternion.setFromEuler(_aimEuler.set(0, placed.yaw + Math.PI, 0));
    cameraReady.current = false;
    lastFeet.x = NaN;
  };

  useFrame((frame, delta) => {
    const rb = rigidBodyRef.current;
    const character = characterRef.current;
    if (!rb || !character) return;

    // A cutscene has the player: only the body it writes is drawn, and the capsule bumps into nothing.
    const collider = rb.collider(0);
    if (isPlayerHeld()) {
      if (collider?.isEnabled()) collider.setEnabled(false);
      setCameraWaterDepth(0);
      posePlayerBody(body, frame.clock.elapsedTime * 1000);
      return;
    }
    if (collider && !collider.isEnabled()) collider.setEnabled(true);
    const placed = takePlayerPlacement();
    if (placed) takePlacement(rb, character, placed);

    const input = inputRef.current;
    const dt = Math.min(delta, MAX_STEP_SECONDS);
    const move = readMoveDirection(camera, input, _moveVec);
    const pos = rb.translation();
    action.noclip = noclip;
    action.sprint = input.sprint;
    action.heading = moveHeadingOf(input);

    if (!terrainLoaded && !noclip) {
      holdAtSpawn(rb, character, dt);
      // A teleport or domain switch: the last sample is another place's water, and the player starts outside.
      water.clear();
      underground.reset();
      surface.reset();
      resetPersonalLight();
      setCameraWaterDepth(0);
      body.visible = false;
      lastFeet.x = NaN;
      return;
    }

    let sewageY = NaN;
    if (noclip) {
      flyNoclip(rb, pos, input, move, dt);
    } else {
      const collider = rb.collider(0);
      if (collider) {
        const ug = underground.update(rb, pos, input, move, character, dt);
        const at = rb.translation();
        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        surface.sample(at.x, at.z, at.y - PLAYER_HEIGHT / 2);
        // Inside a tunnel its sewage is the liquid; outside, the water probe's surface.
        sewageY = ug.sewageY;
        const surfaceY = underground.isInside() ? sewageY : water.surfaceOver(at.y - PLAYER_HEIGHT / 2);
        swimInput.surfaceY = surfaceY;
        swimInput.liquid = underground.isInside() ? "sewage" : "water";
        swimInput.jumpPressed = input.jump && !jumpWasHeld.current;
        const pushed = ug.pushX !== 0 || ug.pushZ !== 0;
        const characterInput = {
          dirX: pushed ? ug.pushX : ug.holdWalk ? 0 : move.x,
          dirZ: pushed ? ug.pushZ : ug.holdWalk ? 0 : move.z,
          speed: pushed ? Math.hypot(ug.pushX, ug.pushZ) : speed,
          jump: input.jump,
          swim: Number.isNaN(surfaceY) ? null : swimInput,
          vyOverride: ug.vyOverride,
          ignoreTerrain: ug.ignoreTerrain,
          surface: surface.modifiers,
        };
        const r = stepCharacter(world, character, rb, collider, at.x, at.y, at.z, characterInput, dt, stepResult);
        safetyNets.escapeIfStuck(r, at, character);
        const onGround = r.grounded || r.walkableSupport;
        // The press frame can still report grounded: a jump is a fresh press that sent the body up.
        if (swimInput.jumpPressed && character.state.vy > 0 && !r.swimming) action.jumped = true;
        else if ((onGround && character.state.vy <= 0) || r.swimming) action.jumped = false;
        action.airborne = !onGround && !r.nearGround && !r.swimming;
        action.swimming = r.swimming;
        action.sliding = r.onSlideSlope && !r.walkableSupport;
        action.climbing = ug.vyOverride !== null && ug.vyOverride > 0;
        action.vy = character.state.vy;
        if (surface.modifiers.snowDepth > SNOW_TRACK_MIN_DEPTH && (r.grounded || r.walkableSupport)) stampSnowTrailAlong(lastStamp, r.x, r.z);
      }
    }

    jumpWasHeld.current = input.jump;

    const finalPos = rb.translation();
    // The personal light comes on after a second in the dark (a tunnel out of its entrances' daylight).
    drivePersonalLight(underground.isInside() ? entranceDaylightAt(finalPos.x, playerEyeY(finalPos.y), finalPos.z) : 1, dt);
    driveFlashlight(flashlight, camera.getWorldDirection(_flashlightDirection), dt);
    if (!noclip && terrainLoaded) safetyNets.runBackstop(finalPos, character);
    safetyNets.respawnIfFallen(finalPos, character);
    followWithCamera(finalPos, rb);
    driveBody(finalPos, rb, move, dt);
    posePlayerBody(body, frame.clock.elapsedTime * 1000);
    playerPosition.set(finalPos.x, finalPos.y, finalPos.z);
    water.sample(finalPos.x, finalPos.z);
    const cameraSurface = underground.isInside() ? sewageY : water.surfaceOver(camera.position.y);
    if (underground.isInside()) setCameraWaterDepth(Number.isNaN(cameraSurface) ? 0 : cameraSurface - camera.position.y, "sewage");
    else setCameraWaterDepth(Number.isNaN(cameraSurface) ? 0 : cameraSurface - camera.position.y, "water", water.colors());
  }, -3);

  return (
    <>
      <PointerLockControls minPolarAngle={CAMERA_PITCH_MARGIN} maxPolarAngle={Math.PI - CAMERA_PITCH_MARGIN} />
      <RigidBody ref={rigidBodyRef} type="kinematicPosition" position={spawn} colliders={false} ccd>
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} collisionGroups={CHARACTER_COLLISION_GROUPS} />
      </RigidBody>
      <Suspense fallback={null}>
        <PlayerBody state={body} />
        {/* Every player body draws this model: its programs link at load, not on the first third-person
            look or the first remote player (a domain without beeble NPCs never warms them otherwise). */}
        <ModelActor.Warmup descriptor={{ model: BEEBLE_SPEC.model!, quantization: BEEBLE_SPEC.quantization }} />
      </Suspense>
    </>
  );
};
