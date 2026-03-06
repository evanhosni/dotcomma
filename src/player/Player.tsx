import { useCylinder } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../context/GameContext";
import { useInput } from "./useInput";

const dev_mode_enabled = new URLSearchParams(window.location.search).get("dev_mode") === "true";

const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
const FALL_RESET_Y = -500;

// Normal mode speeds
const WALK_SPEED = 15;
const SPRINT_SPEED = 30;
const JUMP_IMPULSE = 40;
const GROUND_THRESHOLD = 0.3;

// Dev mode speeds
const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

// Player dimensions
const PLAYER_HEIGHT = 2;
const PLAYER_RADIUS = 0.5;

// Camera
const CAMERA_FAR = 7200;
const CAMERA_LERP = 0.3;

// Reusable vectors (avoid per-frame allocations)
const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _targetVel = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

export const Player = () => {
  const { forward, backward, left, right, sprint, jump, control } = useInput();
  const { camera } = useThree();
  const { terrain_loaded } = useGameContext();

  const velocity = useRef([0, 0, 0]);
  const position = useRef([...SPAWN_POSITION] as [number, number, number]);
  const grounded = useRef(false);
  const cameraReady = useRef(false);

  // Set camera far plane once
  useEffect(() => {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);

  const [ref, api] = useCylinder(() => ({
    mass: 1,
    type: "Dynamic",
    position: [...SPAWN_POSITION],
    args: [PLAYER_RADIUS, PLAYER_RADIUS, PLAYER_HEIGHT, 8],
    material: {
      friction: 0,
      restitution: 0,
    },
    linearDamping: 0.1,
    angularDamping: 1,
    fixedRotation: true,
    allowSleep: false,
    collisionFilterGroup: 1,
    collisionFilterMask: 1,
    linearFactor: [1, 1, 1],
    angularFactor: [0, 0, 0],
    contactEquationStiffness: 1e6,
    contactEquationRelaxation: 4,
    ccdSpeedThreshold: 1,
    ccdIterations: 10,
  }));

  // Subscribe to physics state
  useEffect(() => {
    const unsubVel = api.velocity.subscribe((v) => (velocity.current = v));
    const unsubPos = api.position.subscribe((p) => (position.current = p));
    return () => {
      unsubVel();
      unsubPos();
    };
  }, [api]);

  useFrame((_, delta) => {
    // Clamp delta to prevent huge jumps after tab-switch
    const dt = Math.min(delta, 0.1);

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

    // Hold player in place until terrain colliders are loaded
    if (!terrain_loaded && !dev_mode_enabled) {
      api.velocity.set(0, 0, 0);
      api.position.set(...SPAWN_POSITION);
      const [x, y, z] = SPAWN_POSITION;
      _camTarget.set(x, y + PLAYER_HEIGHT * 0.5, z);
      camera.position.copy(_camTarget);
      cameraReady.current = false;
      return;
    }

    if (dev_mode_enabled) {
      // --- DEV MODE ---
      const hSpeed = sprint ? DEV_SPRINT_SPEED : DEV_SPEED;
      const vSpeed = sprint ? DEV_VERTICAL_SPRINT_SPEED : DEV_VERTICAL_SPEED;

      // Horizontal
      if (_moveVec.lengthSq() > 0) {
        _moveVec.normalize().multiplyScalar(hSpeed);
      }

      // Vertical
      let vy = 0;
      if (jump) vy += vSpeed;
      if (control) vy -= vSpeed;

      // In dev mode, directly set position for zero-gravity feel
      const [px, py, pz] = position.current;
      api.position.set(px + _moveVec.x * dt, py + vy * dt, pz + _moveVec.z * dt);
      api.velocity.set(0, 0, 0);
    } else {
      // --- NORMAL MODE ---
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

      if (_moveVec.lengthSq() > 0) {
        _moveVec.normalize().multiplyScalar(speed);
      }

      // Smooth horizontal velocity
      _targetVel.set(_moveVec.x, velocity.current[1], _moveVec.z);
      const lerpFactor = grounded.current ? 0.25 : 0.08;
      const vx = THREE.MathUtils.lerp(velocity.current[0], _targetVel.x, lerpFactor);
      const vz = THREE.MathUtils.lerp(velocity.current[2], _targetVel.z, lerpFactor);

      // Velocity-based ground detection: grounded when vertical velocity is near zero
      grounded.current = Math.abs(velocity.current[1]) < GROUND_THRESHOLD;

      // Jump
      let vy = velocity.current[1];
      if (jump && grounded.current) {
        vy = JUMP_IMPULSE;
        grounded.current = false;
      }

      api.velocity.set(vx, vy, vz);
    }

    // Safety net: reset if player falls through the world
    if (position.current[1] < FALL_RESET_Y) {
      api.position.set(...SPAWN_POSITION);
      api.velocity.set(0, 0, 0);
      grounded.current = false;
    }

    // Update camera position
    const [x, y, z] = position.current;
    _camTarget.set(x, y + PLAYER_HEIGHT * 0.5, z);

    if (!cameraReady.current) {
      // Snap camera on first frame so there's no lerp-in from origin
      camera.position.copy(_camTarget);
      cameraReady.current = true;
    } else {
      camera.position.lerp(_camTarget, CAMERA_LERP);
    }
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any} />
    </>
  );
};
