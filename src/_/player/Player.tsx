import { useSphere } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VertexData } from "../../types/VertexData";
import { useInput } from "./useInput";

export const Player = ({ vertexData }: { vertexData: (x: number, y: number) => VertexData }) => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();
  const [distanceToGround, setDistanceToGround] = useState(0);
  const [canJump, setCanJump] = useState(true);

  const walkSpeed = 10;
  const sprintSpeed = 20;
  const playerHeight = 2;
  const jumpHeight = 12;
  const gravity = -4; //TODO get gravity from context eventually

  useEffect(() => {
    if (distanceToGround < 0.5 && !jump) {
      setCanJump(true);
    }
    if (distanceToGround > jumpHeight) {
      setCanJump(false);
    }
  }, [distanceToGround, jumpHeight]);

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

  useFrame((state, delta) => {
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
    setDistanceToGround(Math.abs(positionRef.current[1] - 0.5 * playerHeight - terrainHeight));

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

    let jumpVelocity = 0;

    if (jump && canJump) {
      jumpVelocity = Math.sqrt(-gravity * jumpHeight);
    }

    jumpVelocity += gravity * 0.5;

    const newYPosition = Math.max(positionRef.current[1] + jumpVelocity * 0.1, terrainHeight + 0.5 * playerHeight);

    api.position.set(positionRef.current[0], newYPosition, positionRef.current[2]);

    var [x, y, z] = positionRef.current;
    camera.position.lerp(new THREE.Vector3(x, Math.max(y, terrainHeight + playerHeight), z), 0.1);
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any} />
    </>
  );
};
