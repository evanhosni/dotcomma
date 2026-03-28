import type Rapier from "@dimforge/rapier3d-compat";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import type { RapierRigidBody } from "@react-three/rapier";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../context/GameContext";
import { useUrlParameters } from "../context/UrlParametersContext";
import { getVertexData } from "../world/getVertexData";
import { useInput } from "./useInput";

const SPAWN_POSITION: [number, number, number] = [0, 50, 0];
const FALL_RESET_Y = -500;

// Normal mode speeds
const WALK_SPEED = 15;
const SPRINT_SPEED = 45;
const JUMP_IMPULSE = 40;
const MAX_SLOPE_ANGLE = 35 * (Math.PI / 180);
const CC_OFFSET = 0.02;
const SNAP_TO_GROUND = 0.3;

// Dev mode speeds
const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

// Player dimensions
const PLAYER_HEIGHT = 2;
const PLAYER_RADIUS = 0.5;
const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

// Camera
const CAMERA_FAR = 7200;
const CAMERA_LERP = 0.3;

// Gravity (manually integrated for kinematic character controller)
const GRAVITY = -100;
const TERMINAL_VELOCITY = -150;
const MAX_MOVEMENT_PER_FRAME = 8;

// Reusable vectors (avoid per-frame allocations)
const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();

export const Player = () => {
  const inputRef = useInput();
  const { camera } = useThree();
  const { terrain_loaded, playerPosition } = useGameContext();
  const { params } = useUrlParameters();

  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const verticalVelocity = useRef(0);
  const cameraReady = useRef(false);
  const respawning = useRef(false);
  const controllerRef = useRef<Rapier.KinematicCharacterController | null>(null);

  const { world } = useRapier();

  useEffect(() => {
    const controller = world.createCharacterController(CC_OFFSET);
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_ANGLE);
    controller.setMinSlopeSlideAngle(MAX_SLOPE_ANGLE);
    controller.enableSnapToGround(SNAP_TO_GROUND);
    controller.enableAutostep(0.5, 0.2, true);
    controller.setApplyImpulsesToDynamicBodies(true);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world]);

  // Set camera far plane once
  useEffect(() => {
    camera.far = CAMERA_FAR;
    camera.updateProjectionMatrix();
  }, [camera]);

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    const controller = controllerRef.current;
    if (!rb || !controller) return;

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

    // Hold player in place until terrain colliders are loaded
    if (!terrain_loaded && !params.dev) {
      rb.setTranslation({ x: SPAWN_POSITION[0], y: SPAWN_POSITION[1], z: SPAWN_POSITION[2] }, true);
      verticalVelocity.current = 0;
      _camTarget.set(SPAWN_POSITION[0], SPAWN_POSITION[1] + PLAYER_HEIGHT * 0.5, SPAWN_POSITION[2]);
      camera.position.copy(_camTarget);
      cameraReady.current = false;
      return;
    }

    if (params.dev) {
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
      // --- NORMAL MODE (Character Controller) ---
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

      if (_moveVec.lengthSq() > 0) {
        _moveVec.normalize().multiplyScalar(speed);
      }

      // Gravity integration (capped at terminal velocity)
      const grounded = controller.computedGrounded();
      if (grounded && verticalVelocity.current <= 0) {
        verticalVelocity.current = 0;
      } else {
        verticalVelocity.current = Math.max(verticalVelocity.current + GRAVITY * dt, TERMINAL_VELOCITY);
      }

      // Jump
      if (jump && grounded) {
        verticalVelocity.current = JUMP_IMPULSE;
      }

      // Compute desired movement, clamped so the swept capsule query stays reliable
      const desiredMovement = {
        x: _moveVec.x * dt,
        y: verticalVelocity.current * dt,
        z: _moveVec.z * dt,
      };
      const movementDistSq =
        desiredMovement.x * desiredMovement.x +
        desiredMovement.y * desiredMovement.y +
        desiredMovement.z * desiredMovement.z;
      if (movementDistSq > MAX_MOVEMENT_PER_FRAME * MAX_MOVEMENT_PER_FRAME) {
        const scale = MAX_MOVEMENT_PER_FRAME / Math.sqrt(movementDistSq);
        desiredMovement.x *= scale;
        desiredMovement.y *= scale;
        desiredMovement.z *= scale;
      }

      // Let the character controller compute collision-corrected movement
      const collider = rb.collider(0);
      if (collider) {
        controller.computeColliderMovement(collider, desiredMovement);
        const corrected = controller.computedMovement();

        rb.setNextKinematicTranslation({
          x: pos.x + corrected.x,
          y: pos.y + corrected.y,
          z: pos.z + corrected.z,
        });
      }
    }

    // Read final position
    const finalPos = rb.translation();

    // Safety net: if player falls through terrain, respawn at ground height + 10
    if (finalPos.y < FALL_RESET_Y && !respawning.current) {
      respawning.current = true;
      verticalVelocity.current = 0;
      getVertexData(finalPos.x, finalPos.z, true).then((vd) => {
        if (rigidBodyRef.current) {
          rigidBodyRef.current.setTranslation({ x: finalPos.x, y: vd.height + 10, z: finalPos.z }, true);
        }
        verticalVelocity.current = 0;
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
  });

  return (
    <>
      <PointerLockControls />
      <RigidBody ref={rigidBodyRef} type="kinematicPosition" position={SPAWN_POSITION} colliders={false} ccd>
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} />
      </RigidBody>
    </>
  );
};
