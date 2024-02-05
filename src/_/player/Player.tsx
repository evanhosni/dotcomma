import { useSphere } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { VertexData } from "../../types/VertexData";
import { useInput } from "./useInput";

export const Player = ({ vertexData }: { vertexData: (x: number, y: number) => VertexData }) => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();

  const walkSpeed = 10;
  const sprintSpeed = 20;
  const playerHeight = 2;

  const [ref, api] = useSphere(() => ({
    mass: 1,
    type: "Dynamic",
    position: [0, 1, 0],
    fixedRotation: true,
    args: [0.5 * playerHeight],
  }));

  const positionRef = useRef([0, 1, 0]);

  useEffect(() => {
    const unsubscribe = api.position.subscribe((position) => {
      positionRef.current = position;
    });
    return unsubscribe;
  }, [api.position]);

  useFrame(() => {
    const direction = new THREE.Vector3();
    const sideDirection = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    direction.y = 0; // Ensure direction is only horizontal
    direction.normalize();
    sideDirection.crossVectors(upVector, direction).normalize();

    const velocity = new THREE.Vector3(0, 0, 0);

    if (forward) velocity.add(direction);
    if (backward) velocity.sub(direction);
    if (left) velocity.add(sideDirection);
    if (right) velocity.sub(sideDirection);

    const terrainHeight = vertexData(positionRef.current[0], positionRef.current[2]).height;
    const isGrounded = Math.abs(positionRef.current[1] - 0.5 * playerHeight - terrainHeight) < 0.5;

    if (jump && isGrounded) {
      console.log("jump");
      // api.applyLocalImpulse([0, 1000, 0], [0, 0, 0]);
      //TODO jump
    }

    if (forward || backward || left || right) {
      const futurePosition = new THREE.Vector3().addVectors(
        new THREE.Vector3(positionRef.current[0], positionRef.current[1], positionRef.current[2]),
        velocity.normalize().multiplyScalar(0.1)
      );
      const currentHeight = vertexData(positionRef.current[0], positionRef.current[2]).height;
      const futureHeight = vertexData(futurePosition.x, futurePosition.z).height;
      const slope = Math.atan2(futureHeight - currentHeight, 0.1);

      const maxSlope = 20;

      if (slope <= maxSlope) {
        velocity.normalize();
        const currentSpeed = sprint ? sprintSpeed : walkSpeed;
        velocity.multiplyScalar(currentSpeed);
        api.velocity.set(velocity.x, 0, velocity.z);
      } else {
        api.velocity.set(0, 0, 0);
      }
    } else {
      api.velocity.set(0, 0, 0);
    }

    var [x, y, z] = positionRef.current;

    api.position.set(
      positionRef.current[0],
      Math.max(positionRef.current[1], terrainHeight + 0.5 * playerHeight),
      positionRef.current[2]
    );

    camera.position.lerp(new THREE.Vector3(x, Math.max(y, terrainHeight + playerHeight), z), 0.1);
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any}>
        {/* <sphereGeometry args={[0.5 * playerHeight, 32, 32]} />
        <meshStandardMaterial wireframe /> */}
      </mesh>
    </>
  );
};
