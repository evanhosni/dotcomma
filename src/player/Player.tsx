import { useCylinder } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getVertexData } from "../dimensions/glitch-city/getVertexData";
import { useInput } from "./useInput";

const debug_sprint = true;
const debug_jump = true;
const debug_console_log = false;

export const Player = () => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();
  const [distanceToGround, setDistanceToGround] = useState(0);
  const [canJump, setCanJump] = useState(true);
  const frameCount = useRef(0);

  const vertexData = async (x: number, y: number) => {
    return await getVertexData(x, y);
  };

  const walkSpeed = 15;
  const sprintSpeed = debug_sprint ? 250 : 30;
  const playerHeight = 2;
  const playerRadius = 0.5;
  const jumpHeight = 4;
  const gravity = -9.81;

  camera.far = 7200;
  camera.updateProjectionMatrix();

  useEffect(() => {
    if (distanceToGround < 0.5 && !jump) {
      setCanJump(true);
    }
    if (distanceToGround > jumpHeight || (distanceToGround > 0.5 && !jump)) {
      setCanJump(false);
    }
  }, [distanceToGround, jumpHeight, jump]);

  const [ref, api] = useCylinder(() => ({
    mass: 1,
    type: "Dynamic",
    position: [0, 1, 0],
    args: [playerRadius, playerRadius, playerHeight, 8],
    material: {
      friction: 0.1,
      restitution: 0,
    },
    linearDamping: 0.75,
    angularDamping: 0.99,
    fixedRotation: true,
    // Physics settings optimized for performance
    allowSleep: false,
    sleepSpeedLimit: 1,
    sleepTimeLimit: 0.1,
    collisionFilterGroup: 1,
    collisionFilterMask: 1,
    linearFactor: [1, 1, 1],
    angularFactor: [0, 0, 0],
    // Important: These settings help prevent tunneling
    contactEquationRelaxation: 4,
    contactEquationStiffness: 1e6,
  }));

  const velocity = useRef([0, 0, 0]);
  useEffect(() => {
    api.velocity.subscribe((v) => (velocity.current = v));
  }, [api]);

  const positionRef = useRef([0, 1, 0]);
  useEffect(() => {
    const unsubscribe = api.position.subscribe((position) => {
      positionRef.current = position;
    });
    return unsubscribe;
  }, [api.position]);

  useFrame(async () => {
    frameCount.current++;

    const direction = new THREE.Vector3();
    const sideDirection = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    sideDirection.crossVectors(upVector, direction).normalize();

    const moveVelocity = new THREE.Vector3(0, 0, 0);

    if (forward) moveVelocity.add(direction);
    if (backward) moveVelocity.sub(direction);
    if (left) moveVelocity.add(sideDirection);
    if (right) moveVelocity.sub(sideDirection);

    if (moveVelocity.length() > 0) {
      moveVelocity.normalize();
      const currentSpeed = sprint ? sprintSpeed : walkSpeed;

      // Apply smooth acceleration
      const targetVelocity = moveVelocity.multiplyScalar(currentSpeed);
      const currentVelocity = new THREE.Vector3(velocity.current[0], 0, velocity.current[2]);
      currentVelocity.lerp(targetVelocity, 0.2);
      moveVelocity.copy(currentVelocity);
    }

    const terrainHeight = 10;
    setDistanceToGround(Math.abs(positionRef.current[1] - 0.5 * playerHeight - terrainHeight));

    let jumpVelocity = velocity.current[1];

    if (jump && canJump) {
      jumpVelocity = Math.sqrt(-2 * jumpHeight * gravity);
      setCanJump(false);
    }

    const newVelocity = new THREE.Vector3(moveVelocity.x, jumpVelocity, moveVelocity.z);

    // Apply velocity changes less frequently for better performance
    if (frameCount.current % 5 === 0) {
      api.velocity.set(newVelocity.x, newVelocity.y, newVelocity.z);
    }

    const [x, y, z] = positionRef.current;

    if (jump && debug_jump) {
      api.position.set(x, terrainHeight + playerHeight + 420, z);
    }

    if (y < terrainHeight + playerHeight + 10) {
      api.position.set(x, terrainHeight + playerHeight + 10, z);
    }

    camera.position.lerp(new THREE.Vector3(x, y + playerHeight, z), 0.1);
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any} />
    </>
  );
};
