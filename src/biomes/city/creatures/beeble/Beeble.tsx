import { useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";
import { useStateMachine } from "../../../../objects/state/useStateMachine";
import { BEEBLE_SM } from "./stateMachine";

export const Beeble = (props: SpawnedObjectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(
    new THREE.Vector3(...props.coordinates)
  );

  const sm = useStateMachine(BEEBLE_SM, positionRef, groupRef);

  return (
    <group ref={groupRef as any}>
      <GameObject
        model="/models/beeble.glb"
        positionRef={positionRef}
        animationControl={sm.animationControl}
        {...props}
        scale={[10.2, 10.2, 10.2]}
      />
    </group>
  );
};
