import { useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";

export const XLElement = (props: SpawnedObjectProps) => {
  const positionRef = useRef(new THREE.Vector3(...props.coordinates));
  return (
    <group position={props.coordinates}>
      <GameObject model={props.model!} positionRef={positionRef} {...props} />
    </group>
  );
};
