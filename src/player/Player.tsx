import { useSphere } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getVertexData } from "../biomes/glitch-city/getVertexData";
import { useInput } from "./useInput";

const debug_sprint = true; // NOTE: this is temp for testing
const debug_jump = true; // NOTE: this is temp for testing
const debug_console_log = false;

export const Player = () => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();
  const [distanceToGround, setDistanceToGround] = useState(0);
  const [canJump, setCanJump] = useState(true);

  const vertexData = async (x: number, y: number) => {
    // if (debug_console_log) console.log(getVertexData(x, y).attributes.debug);
    return await getVertexData(x, y);
  };

  const walkSpeed = 20;
  const sprintSpeed = debug_sprint ? 300 : 50;
  const playerHeight = 2;
  const jumpHeight = 4;
  const gravity = -9.81; // Standard gravity

  camera.far = 7200; // TODO: better view distance
  camera.updateProjectionMatrix();

  useEffect(() => {
    if (distanceToGround < 0.5 && !jump) {
      setCanJump(true);
    }
    if (distanceToGround > jumpHeight || (distanceToGround > 0.5 && !jump)) {
      setCanJump(false);
    }
  }, [distanceToGround, jumpHeight, jump]);

  const [ref, api] = useSphere(() => ({
    mass: 1,
    type: "Dynamic",
    position: [0, 1, 0],
    args: [0.5 * playerHeight],
    linearDamping: 0.5,
    fixedRotation: true,
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
    const direction = new THREE.Vector3();
    const sideDirection = new THREE.Vector3();
    const upVector = new THREE.Vector3(0, 1, 0);

    camera.getWorldDirection(direction);
    direction.y = 0; // Ensure direction is only horizontal
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
      moveVelocity.multiplyScalar(currentSpeed);
    }

    // const verts = await vertexData(positionRef.current[0], positionRef.current[2]);
    const terrainHeight = 10; // verts.height;
    setDistanceToGround(Math.abs(positionRef.current[1] - 0.5 * playerHeight - terrainHeight));

    let jumpVelocity = velocity.current[1];

    if (jump && canJump) {
      jumpVelocity = Math.sqrt(-2 * jumpHeight * gravity);
      setCanJump(false);
    }

    const newVelocity = new THREE.Vector3(moveVelocity.x, jumpVelocity, moveVelocity.z);

    api.velocity.set(newVelocity.x, newVelocity.y, newVelocity.z);

    const [x, y, z] = positionRef.current;

    if (jump && debug_jump) {
      api.position.set(x, terrainHeight + playerHeight + 420, z);
    }

    // Safety check to ensure player is above terrain height
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
