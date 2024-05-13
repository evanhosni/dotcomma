import { useSphere } from "@react-three/cannon";
import { PointerLockControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GlitchCityDimension } from "../biomes/glitch-city/GlitchCity";
import { getVertexData } from "../biomes/glitch-city/getVertexData";
import { useInput } from "./useInput";

const debug_sprint = true; //TODO this is temp for testing
const debug_console_log = false;

export const Player = () => {
  const { forward, backward, left, right, sprint, jump } = useInput();
  const { camera } = useThree();
  const [distanceToGround, setDistanceToGround] = useState(0);
  const [canJump, setCanJump] = useState(true);
  const [isJumping, setIsJumping] = useState(false);
  const [jumpingPointHeight, setJumpingPointHeight] = useState(0);

  const vertexData = (x: number, y: number) => {
    if (debug_console_log) console.log(getVertexData(x, y, GlitchCityDimension.regions).attributes.debug);

    return getVertexData(x, y, GlitchCityDimension.regions);
  };

  const walkSpeed = 102; //usually 12 i think
  const sprintSpeed = debug_sprint ? 300 : 24;
  const playerHeight = 2;
  const jumpHeight = 12;
  const gravity = -4; //TODO get gravity from context eventually

  camera.far = 7200; //TODO better view distance
  camera.updateProjectionMatrix();

  useEffect(() => {
    if (distanceToGround < 0.5 && !jump) {
      setCanJump(true);
    }
    if (distanceToGround > jumpHeight || (distanceToGround > 0.5 && !jump)) {
      setCanJump(false);
    }
  }, [distanceToGround, jumpHeight]);

  const [ref, api] = useSphere(() => ({
    mass: 20,
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
    setDistanceToGround(Math.abs(positionRef.current[1] - 0.5 * playerHeight - terrainHeight));

    if (forward || backward || left || right) {
      const futurePosition = new THREE.Vector3().addVectors(
        new THREE.Vector3(positionRef.current[0], positionRef.current[1], positionRef.current[2]),
        velocity.normalize().multiplyScalar(0.1)
      );
      const stepPosition = new THREE.Vector3().addVectors(
        new THREE.Vector3(positionRef.current[0], positionRef.current[1], positionRef.current[2]),
        velocity.normalize().multiplyScalar(0.5)
      );
      const currentHeight = vertexData(positionRef.current[0], positionRef.current[2]).height;
      const futureHeight = vertexData(futurePosition.x, futurePosition.z).height;
      const stepHeight = vertexData(stepPosition.x, stepPosition.z).height;
      const slope = Math.atan2(futureHeight - currentHeight, 0.1);

      const maxSlope = 2.9;
      const maxStepHeight = 3000;

      if ((slope <= maxSlope && stepHeight - currentHeight <= maxStepHeight) || distanceToGround > 0.5) {
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

    let jumpVelocity = gravity;

    if (jump && canJump) {
      setJumpingPointHeight(terrainHeight);
      setIsJumping(true);
    }

    if (isJumping) jumpVelocity += Math.sqrt(-gravity * jumpHeight);

    if (Math.abs(positionRef.current[1] - 0.5 * playerHeight - jumpingPointHeight) > jumpHeight) setIsJumping(false); //TODO get distance to jumping point instead

    const newYPosition = Math.max(positionRef.current[1] + jumpVelocity * 0.08, terrainHeight + 0.5 * playerHeight);

    api.position.set(positionRef.current[0], newYPosition, positionRef.current[2]);

    var [x, y, z] = positionRef.current;
    camera.position.lerp(
      new THREE.Vector3(x, Math.max(y, terrainHeight + playerHeight + (sprint && debug_sprint ? 1000 : 0)), z),
      0.1
    );

    // const nearestVertex = new THREE.Vector2(Math.round(x / 4) * 4, Math.round(z / 4) * 4);
    // console.log(nearestVertex); // TODO if needed
  });

  return (
    <>
      <PointerLockControls />
      <mesh ref={ref as any} />
    </>
  );
};
