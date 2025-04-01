import { Debug } from "@react-three/cannon";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import * as THREE from "three";
import { GameObject } from "../../../../../../objects/GameObject";
import { GameObjectProps } from "../../../../../../objects/types";

export const Tenant = (props: GameObjectProps) => {
  const ref = useRef<THREE.Group>(null);
  const positionRef = useRef<THREE.Vector3>(new THREE.Vector3(...props.coordinates));
  const speed = 1;

  useFrame((state, delta) => {
    if (ref.current) {
      positionRef.current.z += speed * delta;
      ref.current.position.copy(positionRef.current);
    }
  });

  return (
    <Debug>
      <group ref={ref as any}>
        <GameObject model="/models/tenant.glb" positionRef={positionRef} {...props} scale={[10, 10, 10]} />
      </group>
    </Debug>
  );
};
