import { RigidBody, CapsuleCollider, useRapier } from "@react-three/rapier";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { useMouseEvents } from "../../../../objects/state/useMouseEvents";
import { useStateMachine } from "../../../../objects/state/useStateMachine";
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

const HAS_CLICK_TRIGGER = BEEBLE_SM.triggers.some((t) => t.id === "mouse-left-click");

export const Beeble = (props: SpawnedObjectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const rigidBodyRef = useRef<RapierRigidBody>(null);
  const controllerRef = useRef<Rapier.KinematicCharacterController | null>(null);
  const verticalVelocity = useRef(0);

  const { world } = useRapier();

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);
  const mouseEvents = useMouseEvents(sm, groupRef, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
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

  useFrame((_, delta) => {
    const rb = rigidBodyRef.current;
    const controller = controllerRef.current;
    if (!rb || !controller) return;

    const dt = Math.min(delta, 0.1);
    const bb = sm.blackboard;
    const velX = bb.__vel_x ?? 0;
    const velZ = bb.__vel_z ?? 0;
    const velY = bb.__vel_y;

    const pos = rb.translation();

    // Gravity integration
    const grounded = controller.computedGrounded();
    if (velY !== undefined) {
      verticalVelocity.current = velY;
    } else if (grounded && verticalVelocity.current <= 0) {
      verticalVelocity.current = 0;
    } else {
      verticalVelocity.current += GRAVITY * dt;
    }

    const desiredMovement = {
      x: velX * dt,
      y: verticalVelocity.current * dt,
      z: velZ * dt,
    };

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
      <group
        ref={groupRef as any}
        onPointerOver={mouseEvents.onPointerOver}
        onPointerOut={mouseEvents.onPointerOut}
        onClick={mouseEvents.onClick}
        onContextMenu={mouseEvents.onContextMenu}
        onPointerDown={mouseEvents.onPointerDown}
        onPointerUp={mouseEvents.onPointerUp}
        onDoubleClick={mouseEvents.onDoubleClick}
        onWheel={mouseEvents.onWheel}
      >
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
