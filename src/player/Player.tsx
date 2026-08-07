import type Rapier from "@dimforge/rapier3d-compat";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { CapsuleCollider, RigidBody, useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useDevMode } from "../context/DevContext";
import { useGameContext } from "../context/GameContext";
import { usePortalContext } from "../portals/PortalContext";
import { getVertexData, getVertexDataRaw } from "../world/vertexData";
import { useInput } from "./useInput";

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
const JUMP_IMPULSE = 40;
// Gap the controller keeps from surfaces. 0.02 was thin enough that fast
// glancing contact on steep slopes could numerically penetrate the terrain
// trimesh — and a sweep that STARTS inside a triangle passes through it
// (the fall-through-the-map bug). 0.08 keeps the capsule reliably outside.
const CC_OFFSET = 0.08;
const SNAP_TO_GROUND = 0.3;

// ---- Slopes ----
// Three bands instead of a hard stop at the old 35° limit:
//   ≤ SOFT_START:            full speed.
//   SOFT_START..SOFT_END:    the UPHILL component of input scales smoothly
//                            from 1 → 0 (walking along the contour or downhill
//                            stays full speed).
//   > SOFT_END:              unclimbable — the player slides down the slope's
//                            fall line, accelerating with gravity's tangential
//                            component; momentum bleeds off quickly on
//                            walkable ground. No jumping mid-slide.
// The Rapier controller's own climb limit sits at SOFT_END (it provides the
// hard wall + downhill deflection); everything softer is shaped here from a
// ground-normal raycast. The band is deliberately WIDE (20°) so the slowdown
// creeps in gradually — the smoothstep keeps the ends gentle, so around the
// old 35° limit you still walk at roughly half speed.
const SLOPE_SOFT_START = 25 * (Math.PI / 180);
const SLOPE_SOFT_END = 45 * (Math.PI / 180);
const SLIDE_MAX_SPEED = 30;
const SLIDE_STOP_DECEL = 60; // how fast leftover slide momentum dies on walkable ground
// While riding an unclimbable slope, gravity must not wind up to terminal
// velocity — a huge downward component fed into a glancing steep contact is
// exactly what used to punch through the trimesh. The slide vector provides
// the downhill motion; this just keeps the capsule pressed to the surface.
const SLIDE_FALL_CLAMP = -20;

// Devmode speeds
const DEV_SPEED = 60;
const DEV_SPRINT_SPEED = 300;
const DEV_VERTICAL_SPEED = 60;
const DEV_VERTICAL_SPRINT_SPEED = 300;

// Player dimensions
const PLAYER_HEIGHT = 2;
const PLAYER_RADIUS = 0.5;
const CAPSULE_HALF_HEIGHT = PLAYER_HEIGHT / 2 - PLAYER_RADIUS;

// Ground-normal probe: cast long, then accept the hit adaptively by SLOPE —
// the vertical distance from the capsule center to the surface grows as
// 1/cos(angle) on inclines (the capsule rests against them sideways). A
// fixed feet-length reach was used before and REJECTED: beyond ~55° the ray
// stopped reaching the ground, so the steep-slope slide never engaged and
// jumping stayed possible exactly on the slopes that should forbid it.
const GROUND_RAY_LENGTH = 5;
const GROUND_RAY_SLACK = SNAP_TO_GROUND + 0.4;

// Camera
const CAMERA_FAR = 7200;
const CAMERA_LERP = 0.3;

// Gravity (manually integrated for kinematic character controller)
const GRAVITY = -100;
const TERMINAL_VELOCITY = -150;
const MAX_MOVEMENT_PER_FRAME = 8;
// The KCC solve is SUBSTEPPED so no single swept solve moves farther than
// ~the capsule radius: one long glancing sweep along a steep slope is the
// other half of the tunneling bug (corrections apply too late, penetration
// accumulates). 16 substeps covers MAX_MOVEMENT_PER_FRAME.
const MAX_SUBSTEP_DISTANCE = 0.5;
const MAX_SUBSTEPS = 16;

// Reusable vectors (avoid per-frame allocations)
const _direction = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _moveVec = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _uphill = new THREE.Vector3();
// Persists across frames: the last slide direction keeps pushing while the
// leftover momentum decays after reaching walkable ground.
const _slideDir = new THREE.Vector3();

const smooth01 = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

export const Player = () => {
  const inputRef = useInput();
  const { camera } = useThree();
  const { terrain_loaded, playerPosition } = useGameContext();
  const { noclip } = useDevMode();

  const { playerRigidBodyRef, activeIndoorId } = usePortalContext();
  const rigidBodyRef = playerRigidBodyRef;
  const verticalVelocity = useRef(0);
  const slideSpeed = useRef(0);
  const cameraReady = useRef(false);
  const respawning = useRef(false);
  const controllerRef = useRef<Rapier.KinematicCharacterController | null>(null);
  const groundRayRef = useRef<Rapier.Ray | null>(null);
  const groundCheckFrame = useRef(0);
  const stuckFrames = useRef(0);
  const unsticking = useRef(false);

  const { world, rapier } = useRapier();

  useEffect(() => {
    const controller = world.createCharacterController(CC_OFFSET);
    // The hard wall lives at SOFT_END — the 35°..45° band is climbable but
    // speed-shaped in the frame loop, and beyond it the controller both
    // blocks climbing and deflects gravity down the slope.
    controller.setMaxSlopeClimbAngle(SLOPE_SOFT_END + 0.01);
    controller.setMinSlopeSlideAngle(SLOPE_SOFT_END);
    // Push the capsule OUT along contact normals noticeably harder than the
    // default (1e-4): shallow penetrations on steep glancing contacts must
    // recover instead of accumulating until a sweep starts inside the trimesh.
    controller.setNormalNudgeFactor(0.02);
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

    // Hold player in place until terrain colliders are loaded (outdoor world only)
    const needsTerrain = !activeIndoorId;
    if (needsTerrain && !terrain_loaded && !noclip) {
      rb.setTranslation({ x: SPAWN_POSITION[0], y: SPAWN_POSITION[1], z: SPAWN_POSITION[2] }, true);
      verticalVelocity.current = 0;
      _camTarget.set(SPAWN_POSITION[0], SPAWN_POSITION[1] + PLAYER_HEIGHT * 0.5, SPAWN_POSITION[2]);
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
      // --- NORMAL MODE (Character Controller) ---
      const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
      const grounded = controller.computedGrounded();
      const collider = rb.collider(0);

      // ---- Ground slope probe (capsule center straight down) ----
      // Runs EVERY frame, not just when computedGrounded() says so — Rapier's
      // grounded flag flickers false on too-steep surfaces, which is exactly
      // where the slope logic matters most.
      let nearGround = false;
      let groundAngle = 0;
      let nX = 0;
      let nY = 1;
      let nZ = 0;
      if (collider) {
        if (!groundRayRef.current) {
          groundRayRef.current = new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
        }
        const ray = groundRayRef.current;
        ray.origin.x = pos.x;
        ray.origin.y = pos.y;
        ray.origin.z = pos.z;
        const hit = world.castRayAndGetNormal(
          ray,
          GROUND_RAY_LENGTH,
          false,
          undefined,
          undefined,
          collider,
          rb,
          (c) => !c.isSensor()
        );
        if (hit) {
          // Trimesh normals can face either way — orient upward.
          const flip = hit.normal.y < 0 ? -1 : 1;
          const hnX = hit.normal.x * flip;
          const hnY = hit.normal.y * flip;
          const hnZ = hit.normal.z * flip;
          // Slope-adaptive acceptance: on an incline the surface sits
          // 1/cos(angle) farther below the center, so the allowed distance
          // scales with the hit's own normal (flat ground: feet + snap, same
          // as the old fixed reach; ~76°+ counts as wall, not ground).
          const allowed = PLAYER_HEIGHT / 2 / Math.max(hnY, 0.25) + GROUND_RAY_SLACK;
          if (hit.timeOfImpact <= allowed) {
            nearGround = true;
            nX = hnX;
            nY = hnY;
            nZ = hnZ;
            groundAngle = Math.acos(Math.min(Math.max(nY, -1), 1));
          }
        }
      }
      const onSlideSlope = nearGround && groundAngle > SLOPE_SOFT_END;

      // ---- Input, shaped by slope ----
      if (_moveVec.lengthSq() > 0) {
        _moveVec.normalize();
        // In the soft band, only the UPHILL component of the input slows —
        // full speed along the contour and downhill.
        if (nearGround && groundAngle > SLOPE_SOFT_START) {
          const hLen = Math.hypot(nX, nZ);
          if (hLen > 1e-5) {
            _uphill.set(-nX / hLen, 0, -nZ / hLen);
            const uphillFactor = Math.max(0, _moveVec.dot(_uphill));
            const climb = 1 - smooth01((groundAngle - SLOPE_SOFT_START) / (SLOPE_SOFT_END - SLOPE_SOFT_START));
            _moveVec.multiplyScalar(speed * (1 - uphillFactor * (1 - climb)));
          } else {
            _moveVec.multiplyScalar(speed);
          }
        } else {
          _moveVec.multiplyScalar(speed);
        }
      }

      // ---- Slide on unclimbable slopes ----
      if (onSlideSlope) {
        // Fall line: gravity projected onto the slope plane.
        _slideDir.set(nY * nX, nY * nY - 1, nY * nZ).normalize();
        slideSpeed.current = Math.min(
          SLIDE_MAX_SPEED,
          slideSpeed.current + -GRAVITY * Math.sin(groundAngle) * dt
        );
      } else {
        // Leftover momentum carries in the last slide direction and bleeds
        // off quickly once the ground is walkable again.
        slideSpeed.current = Math.max(0, slideSpeed.current - SLIDE_STOP_DECEL * dt);
      }

      // Gravity integration (capped at terminal velocity)
      if (grounded && verticalVelocity.current <= 0) {
        verticalVelocity.current = 0;
      } else {
        verticalVelocity.current = Math.max(verticalVelocity.current + GRAVITY * dt, TERMINAL_VELOCITY);
      }
      // Riding an unclimbable slope: cap the fall speed. Without this,
      // gravity winds toward terminal velocity while the capsule scrapes the
      // surface at a glancing angle — the huge downward sweep is what used to
      // punch the player through the terrain trimesh.
      if (onSlideSlope && verticalVelocity.current < SLIDE_FALL_CLAMP) {
        verticalVelocity.current = SLIDE_FALL_CLAMP;
      }

      // Jump — not while sliding on an unclimbable slope
      if (jump && grounded && !onSlideSlope) {
        verticalVelocity.current = JUMP_IMPULSE;
      }

      // Compute desired movement, clamped so the swept capsule query stays reliable
      const desiredMovement = {
        x: (_moveVec.x + _slideDir.x * slideSpeed.current) * dt,
        y: verticalVelocity.current * dt + _slideDir.y * slideSpeed.current * dt,
        z: (_moveVec.z + _slideDir.z * slideSpeed.current) * dt,
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

      // Let the character controller compute collision-corrected movement.
      // SUBSTEPPED: each swept solve covers at most ~a capsule radius. One
      // long sweep along a glancing steep contact lets penetration build up
      // before the correction lands — and a sweep that starts inside the
      // trimesh falls straight through. Between substeps the body teleports
      // to the corrected spot (invisible — physics steps after this
      // callback); at the end it's restored and moved kinematically so
      // dynamic-body interactions see proper velocities.
      if (collider) {
        const dist = Math.sqrt(
          desiredMovement.x * desiredMovement.x +
            desiredMovement.y * desiredMovement.y +
            desiredMovement.z * desiredMovement.z
        );
        const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / MAX_SUBSTEP_DISTANCE)));
        const stepMove = {
          x: desiredMovement.x / steps,
          y: desiredMovement.y / steps,
          z: desiredMovement.z / steps,
        };
        let fx = pos.x;
        let fy = pos.y;
        let fz = pos.z;
        for (let i = 0; i < steps; i++) {
          controller.computeColliderMovement(collider, stepMove, undefined, undefined, (c) => !c.isSensor());
          const corrected = controller.computedMovement();
          fx += corrected.x;
          fy += corrected.y;
          fz += corrected.z;
          if (steps > 1 && i < steps - 1) {
            // Colliders only follow their body at the physics step — propagate
            // explicitly so the next substep's sweep starts from this spot.
            rb.setTranslation({ x: fx, y: fy, z: fz }, false);
            world.propagateModifiedBodyPositionsToColliders();
          }
        }
        if (steps > 1) {
          rb.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, false);
          world.propagateModifiedBodyPositionsToColliders();
        }
        rb.setNextKinematicTranslation({ x: fx, y: fy, z: fz });

        // ---- Stuck detection (wedged-in-the-ground escape) ----
        // A capsule SLIGHTLY embedded in the terrain (below the backstop's
        // tolerance — e.g. a LOD swap raised the heightfield a hair) makes
        // every sweep start inside the surface and return ~zero: the player
        // is wedged. Signal: sustained input with almost no resulting
        // horizontal movement. Confirmed against the analytic height (so
        // pushing against a building wall — legitimately blocked — never
        // triggers), the fix is lifting exactly to the surface.
        const wantSq = desiredMovement.x * desiredMovement.x + desiredMovement.z * desiredMovement.z;
        const gotX = fx - pos.x;
        const gotZ = fz - pos.z;
        const gotSq = gotX * gotX + gotZ * gotZ;
        if (wantSq > 1e-6 && gotSq < wantSq * 0.0025) {
          stuckFrames.current++;
        } else {
          stuckFrames.current = 0;
        }
        if (
          stuckFrames.current >= STUCK_FRAMES_TRIGGER &&
          !unsticking.current &&
          !activeIndoorId &&
          terrain_loaded &&
          !respawning.current
        ) {
          unsticking.current = true;
          const sx = fx;
          const sz = fz;
          // Raw (pad-free) height: pads sit ABOVE raw terrain, so the
          // below-surface test stays sound — and the padded path would
          // compute flatten tiles synchronously on the main thread.
          getVertexDataRaw(sx, sz).then((vd) => {
            unsticking.current = false;
            const body = rigidBodyRef.current;
            if (!body) return;
            const cur = body.translation();
            if (Math.abs(cur.x - sx) > 3 || Math.abs(cur.z - sz) > 3) return; // stale
            const bottom = cur.y - PLAYER_HEIGHT / 2;
            if (bottom < vd.height - STUCK_EMBED_MIN) {
              body.setTranslation({ x: cur.x, y: vd.height + PLAYER_HEIGHT / 2 + 0.1, z: cur.z }, true);
              verticalVelocity.current = 0;
              slideSpeed.current = 0;
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
    // two. Outdoors only — interiors sit far above terrain.
    if (!activeIndoorId && !noclip && terrain_loaded && !respawning.current) {
      groundCheckFrame.current++;
      if (groundCheckFrame.current % GROUND_CHECK_INTERVAL === 0) {
        const cx = finalPos.x;
        const cz = finalPos.z;
        // Raw (pad-free) height — see the stuck-escape note above.
        getVertexDataRaw(cx, cz).then((vd) => {
          const body = rigidBodyRef.current;
          if (!body) return;
          const cur = body.translation();
          // Stale sample — the player moved columns (or teleported through a
          // portal) between the request and now.
          if (Math.abs(cur.x - cx) > 3 || Math.abs(cur.z - cz) > 3) return;
          const bottom = cur.y - PLAYER_HEIGHT / 2;
          if (bottom < vd.height - EMBED_TOLERANCE) {
            body.setTranslation({ x: cur.x, y: vd.height + PLAYER_HEIGHT / 2 + 0.1, z: cur.z }, true);
            verticalVelocity.current = 0;
            slideSpeed.current = 0;
          }
        });
      }
    }

    // Safety net: if player falls through terrain, respawn at ground height + 10 (outdoor only)
    if (!activeIndoorId && finalPos.y < FALL_RESET_Y && !respawning.current) {
      respawning.current = true;
      verticalVelocity.current = 0;
      getVertexData(finalPos.x, finalPos.z).then((vd) => {
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
  }, -3);

  return (
    <>
      <PointerLockControls />
      <RigidBody ref={rigidBodyRef} type="kinematicPosition" position={SPAWN_POSITION} colliders={false} ccd>
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, PLAYER_RADIUS]} />
      </RigidBody>
    </>
  );
};
