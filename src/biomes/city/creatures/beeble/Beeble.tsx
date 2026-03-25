import { useCylinder } from "@react-three/cannon";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { useMouseEvents } from "../../../../objects/state/useMouseEvents";
import { useStateMachine } from "../../../../objects/state/useStateMachine";
import { BEEBLE_SM } from "./stateMachine";

const BEEBLE_RADIUS = 0.5;
const BEEBLE_HEIGHT = 2.4;

const HAS_CLICK_TRIGGER = BEEBLE_SM.triggers.some((t) => t.id === "mouse-left-click");

export const Beeble = (props: SpawnedObjectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const velocityRef = useRef([0, 0, 0]);

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);
  const mouseEvents = useMouseEvents(sm, groupRef, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
  });

  const [physRef, api] = useCylinder(() => ({
    mass: 1,
    type: "Dynamic",
    position: [props.coordinates[0], props.coordinates[1] + BEEBLE_HEIGHT / 2, props.coordinates[2]],
    args: [BEEBLE_RADIUS, BEEBLE_RADIUS, BEEBLE_HEIGHT, 8],
    material: { friction: 0, restitution: 0 },
    fixedRotation: true,
    angularDamping: 1,
    linearDamping: 0.1,
    allowSleep: false,
    collisionFilterGroup: 1,
    collisionFilterMask: 1,
    angularFactor: [0, 0, 0],
  }));

  useEffect(() => {
    const unsubPos = api.position.subscribe((p) => {
      positionRef.current.set(p[0], p[1], p[2]);
    });
    const unsubVel = api.velocity.subscribe((v) => {
      velocityRef.current = v;
    });
    return () => {
      unsubPos();
      unsubVel();
    };
  }, [api]);

  // Apply velocity from state machine blackboard and sync group position
  useFrame(() => {
    const bb = sm.blackboard;
    const velX = bb.__vel_x ?? 0;
    const velZ = bb.__vel_z ?? 0;
    const velY = bb.__vel_y;

    if (velY !== undefined) {
      // Ascending: override vertical velocity
      api.velocity.set(velX, velY, velZ);
    } else {
      // Ground movement: preserve physics vertical velocity (gravity)
      api.velocity.set(velX, velocityRef.current[1], velZ);
    }

    // Sync group position from physics body (offset down by half cylinder height
    // so model feet align with bottom of collider)
    if (groupRef.current) {
      groupRef.current.position.set(
        positionRef.current.x,
        positionRef.current.y - BEEBLE_HEIGHT / 2,
        positionRef.current.z,
      );
    }
  });

  return (
    <>
      <mesh ref={physRef as any} visible={false} />
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
          scale={[1.2, 1.2, 1.2]}
        />
      </group>
    </>
  );
};
