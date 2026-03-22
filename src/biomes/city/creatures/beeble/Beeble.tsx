import { useCallback, useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { showCursor, hideCursor } from "../../../../utils/cursor/cursor";
import { useStateMachine } from "../../../../objects/state/useStateMachine";
import { BEEBLE_SM } from "./stateMachine";

export const Beeble = (props: SpawnedObjectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);

  const handlePointerOver = useCallback(() => showCursor(), []);
  const handlePointerOut = useCallback(() => hideCursor(), []);

  return (
    <group
      ref={groupRef as any}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
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
