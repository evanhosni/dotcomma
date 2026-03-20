import { Debug } from "@react-three/cannon";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../objects/GameObject";
import { SpawnedObjectProps } from "../../../../objects/spawning/types";

export const Beeble = (props: SpawnedObjectProps) => {
  const ref = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const speed = 50;

  useFrame((state, delta) => {
    if (ref.current) {
      positionRef.current.x += speed * delta;
      ref.current.position.copy(positionRef.current);
    }
  });

  ///1.2 scale seems appropriate size

  return (
    <Debug>
      <group ref={ref as any}>
        <GameObject model="/models/beeble.glb" positionRef={positionRef} {...props} scale={[10.2, 10.2, 10.2]} />
      </group>
    </Debug>
  );
};
