import { useRef } from "react";
import * as THREE from "three";
import { ModelActor } from "../ModelActor";
import { ActorProps } from "../spawning/types";

export const BigBeeble = (props: ActorProps) => {
  const positionRef = useRef(new THREE.Vector3(...props.coordinates));
  return (
    <group position={props.coordinates}>
      <ModelActor model={props.model!} positionRef={positionRef} {...props} />
    </group>
  );
};
