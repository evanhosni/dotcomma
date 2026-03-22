import { useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { useStateMachine } from "../../../../objects/state/useStateMachine";
import { useMouseEvents } from "../../../../objects/state/useMouseEvents";
import { BEEBLE_SM } from "./stateMachine";

const HAS_CLICK_TRIGGER = BEEBLE_SM.triggers.some((t) => t.id === "mouse-left-click");

export const Beeble = (props: SpawnedObjectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);
  const mouseEvents = useMouseEvents(sm, {
    shouldGrowCursor: props.cursorOverride ?? HAS_CLICK_TRIGGER,
  });

  return (
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
  );
};
