import { RigidBody, CapsuleCollider, useRapier } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../GameObject";
import { ActorProps } from "../../spawning/types";
import { useMouseEvents } from "../../state/useMouseEvents";
import { useStateMachine } from "../../state/useStateMachine";
import { framePhaseFromCoords } from "../../../utils/utils";
import { BEEBLE_SM } from "./stateMachine";
import type { RapierRigidBody } from "@react-three/rapier";
import type Rapier from "@dimforge/rapier3d-compat";

const BEEBLE_RADIUS = 0.5;
const BEEBLE_HEIGHT = 2.4;
const CAPSULE_HALF_HEIGHT = BEEBLE_HEIGHT / 2 - BEEBLE_RADIUS;
const MAX_SLOPE_ANGLE = 35 * (Math.PI / 180);
const CC_OFFSET = 0.02;
const SNAP_TO_GROUND = 0.3;
const GRAVITY = -100;
// Physics LOD: character-controller shape casts are the per-frame CPU cost of
// each beeble. Within this camera distance they resolve every frame; beyond
// it, every Nth frame with accumulated dt (speed is preserved — movement per
// step is velocity × accumulated time). Idle grounded beebles skip entirely.
const PHYSICS_FULL_RATE_DIST = 80;
const PHYSICS_THROTTLE_FRAMES = 3;
const MAX_PHYSICS_CATCHUP = 0.15;

const HAS_CLICK_TRIGGER = BEEBLE_SM.triggers.some((t) => t.id === "mouse-left-click");

// Scratch objects for the per-frame physics step — computeColliderMovement
// and setNextKinematicTranslation both consume their argument synchronously,
// and useFrame callbacks run sequentially, so module-level reuse is safe
// (allocating fresh {x,y,z} literals per active beeble per frame was GC churn).
const _desiredMovement = { x: 0, y: 0, z: 0 };
const _nextTranslation = { x: 0, y: 0, z: 0 };

export const Beeble = (props: ActorProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const controllerRef = useRef<Rapier.KinematicCharacterController | null>(null);
  const verticalVelocity = useRef(0);
  const pendingDtRef = useRef(0);
  const framePhase = useRef(
    framePhaseFromCoords(props.coordinates[0], props.coordinates[2], PHYSICS_THROTTLE_FRAMES),
  ).current;
  const physicsFrameRef = useRef(framePhase);
  const groundedRef = useRef(false);
  const hasComputedRef = useRef(false);

  const { world } = useRapier();

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);
  // Mouse interaction is fully handled inside useMouseEvents (window
  // listeners + a manual screen-center raycast) — nothing is attached to the
  // R3F group, see the note at the end of useMouseEvents.
  useMouseEvents(sm, groupRef, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
    framePhase,
  });

  useEffect(() => {
    const controller = world.createCharacterController(CC_OFFSET);
    controller.setMaxSlopeClimbAngle(MAX_SLOPE_ANGLE);
    controller.setMinSlopeSlideAngle(MAX_SLOPE_ANGLE);
    controller.enableSnapToGround(SNAP_TO_GROUND);
    controller.enableAutostep(0.5, 0.2, true);
    controllerRef.current = controller;
    return () => {
      world.removeCharacterController(controller);
      controllerRef.current = null;
    };
  }, [world]);

  useFrame((state, delta) => {
    const rb = rigidBodyRef.current;
    const controller = controllerRef.current;
    if (!rb || !controller) return;

    const bb = sm.blackboard;
    const velX = bb.__vel_x ?? 0;
    const velZ = bb.__vel_z ?? 0;
    const velY = bb.__vel_y;

    const pos = rb.translation();

    physicsFrameRef.current++;
    pendingDtRef.current = Math.min(pendingDtRef.current + Math.min(delta, 0.1), MAX_PHYSICS_CATCHUP);

    // Idle short-circuit: standing still on the ground with no vertical
    // motion — nothing to resolve, skip the shape cast entirely.
    const idle =
      hasComputedRef.current &&
      groundedRef.current &&
      velY === undefined &&
      velX === 0 &&
      velZ === 0 &&
      verticalVelocity.current === 0;
    if (idle) {
      pendingDtRef.current = 0;
      return;
    }

    // Distance LOD: far-away beebles resolve collisions every Nth frame with
    // the accumulated dt, so their speed is unchanged.
    const dxCam = state.camera.position.x - pos.x;
    const dzCam = state.camera.position.z - pos.z;
    const isFar = dxCam * dxCam + dzCam * dzCam > PHYSICS_FULL_RATE_DIST * PHYSICS_FULL_RATE_DIST;
    if (isFar && physicsFrameRef.current % PHYSICS_THROTTLE_FRAMES !== 0) return;

    const dt = pendingDtRef.current;
    pendingDtRef.current = 0;

    // Gravity integration
    const grounded = controller.computedGrounded();
    groundedRef.current = grounded;
    if (velY !== undefined) {
      verticalVelocity.current = velY;
    } else if (grounded && verticalVelocity.current <= 0) {
      verticalVelocity.current = 0;
    } else {
      verticalVelocity.current += GRAVITY * dt;
    }

    _desiredMovement.x = velX * dt;
    _desiredMovement.y = verticalVelocity.current * dt;
    _desiredMovement.z = velZ * dt;

    const collider = rb.collider(0);
    if (collider) {
      controller.computeColliderMovement(collider, _desiredMovement);
      const corrected = controller.computedMovement();
      hasComputedRef.current = true;

      _nextTranslation.x = pos.x + corrected.x;
      _nextTranslation.y = pos.y + corrected.y;
      _nextTranslation.z = pos.z + corrected.z;
      rb.setNextKinematicTranslation(_nextTranslation);
    }

    const finalPos = rb.translation();
    positionRef.current.set(finalPos.x, finalPos.y, finalPos.z);

    if (groupRef.current) {
      groupRef.current.position.set(
        finalPos.x,
        finalPos.y - BEEBLE_HEIGHT / 2,
        finalPos.z,
      );
    }
  });

  return (
    <>
      <RigidBody
        ref={rigidBodyRef}
        type="kinematicPosition"
        position={[props.coordinates[0], props.coordinates[1] + BEEBLE_HEIGHT / 2, props.coordinates[2]]}
        colliders={false}
      >
        <CapsuleCollider args={[CAPSULE_HALF_HEIGHT, BEEBLE_RADIUS]} />
      </RigidBody>
      {/* NO pointer handler props here — even no-op handlers register the
          group in R3F's interaction list, costing a recursive raycast (full
          CPU-skinned triangle tests) per beeble on every pointermove. */}
      <group ref={groupRef as any}>
        <GameObject
          model="/models/beeble.glb"
          positionRef={positionRef}
          animationControl={sm.animationControl}
          {...props}
          isStatic={false}
          scale={[1.2, 1.2, 1.2]}
        />
      </group>
    </>
  );
};
