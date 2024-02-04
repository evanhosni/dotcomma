import { useSphere } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useInput } from "./useInput";

export const Player = () => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();

  const walkSpeed = 10; // Increased speed for more responsive movement
  const sprintSpeed = 20; // Adjust speed values as needed

  // Player physics body for collision detection
  const [ref, api] = useSphere(() => ({
    mass: 1,
    type: "Dynamic",
    position: [0, 1, 0],
    fixedRotation: true, // This keeps the player upright
    args: [1], // Adjust the radius as needed
  }));

  const positionRef = useRef([0, 1, 0]);

  useEffect(() => {
    const unsubscribe = api.position.subscribe((position) => {
      positionRef.current = position;
    });
    return unsubscribe; // Cleanup subscription on component unmount
  }, [api.position]);

  useFrame(() => {
    const direction = new THREE.Vector3();
    const sideDirection = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    sideDirection.crossVectors(upVector, direction).normalize();

    const velocity = new THREE.Vector3(0, 0, 0);

    if (forward) velocity.add(direction);
    if (backward) velocity.sub(direction);
    if (left) velocity.add(sideDirection);
    if (right) velocity.sub(sideDirection);

    if (velocity.lengthSq() > 0) {
      velocity.normalize();
      const currentSpeed = sprint ? sprintSpeed : walkSpeed;
      velocity.multiplyScalar(currentSpeed);
    }

    api.velocity.set(velocity.x, 0, velocity.z);

    const [x, y, z] = positionRef.current;
    camera.position.lerp(new THREE.Vector3(x, y, z), 0.1); // Adjust the lerp factor (0.1) for smoothness
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any} />
    </>
  );
};
