import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { claimHover, releaseHover, type HoverTarget } from "../../../../utils/cursor";
import { enterOverworld } from "../../navigation";
import { CRT_GLOW } from "./constants";
import { CRT_POWER, createScreenMaterial } from "./material";

const SCREEN_W = 4.8; // 4:3
const SCREEN_H = 3.6;

// Beyond a door's reach (6, building/spec.ts DOOR_INTERACT_REACH): the screen is huge, you click it from conversation distance.
const INTERACT_DISTANCE = 14;
const HOVER_CHECK_DISTANCE = 50;

// Shell dimensions (local; group origin = screen center)
const BEZEL = 0.6;
const FRAME_DEPTH = 0.95;
const FRAME_Z = -0.225; // screen (z=0) recessed 0.25 behind the bezel front
const BACK_Z = -2.2;
const BACK_DEPTH = 3.2;

/** The collider: one box around the bezel and the back housing. */
const BODY_HALF: THREE.Vector3Tuple = [SCREEN_W / 2 + BEZEL, SCREEN_H / 2 + BEZEL, (FRAME_Z + FRAME_DEPTH / 2 - (BACK_Z - BACK_DEPTH / 2)) / 2];
const BODY_CENTER_Z = (FRAME_Z + FRAME_DEPTH / 2 + BACK_Z - BACK_DEPTH / 2) / 2;

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _worldPos = new THREE.Vector3();

/**
 * The home page's TV: it powers on into static after the first pointer lock, and clicking it within
 * INTERACT_DISTANCE drops the player into the overworld (navigation.ts enterOverworld). Solid: one fixed
 * box, imperative like every other body. The glow light is PARKED at intensity 0 from mount: a light
 * appearing mid-play changes NUM_POINT_LIGHTS and recompiles every lit shader at that frame.
 */
export const CrtMonitor = ({ position, delayMs = 1000, fadeMs = 2000 }: { position: THREE.Vector3Tuple; delayMs?: number; fadeMs?: number }) => {
  const { camera } = useThree();
  const { world, rapier } = useRapier();
  const screenRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const ledMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const powerOnTriggeredRef = useRef(false);
  const powerProgressRef = useRef(0);
  const frameRef = useRef(0);

  const screenMaterial = useMemo(createScreenMaterial, []);
  const shellMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: "#262626", roughness: 0.85 }), []);
  const hoverTarget = useMemo<HoverTarget>(
    () => ({
      distance: Infinity,
      growsCursor: true,
      onMouse: (e) => {
        if (e.type === "click" && e.button === 0) enterOverworld();
      },
    }),
    [],
  );

  useEffect(() => {
    CRT_POWER.value = 0;
    return () => {
      screenMaterial.dispose();
      shellMaterial.dispose();
      releaseHover(hoverTarget);
    };
  }, [screenMaterial, shellMaterial, hoverTarget]);

  const [px, py, pz] = position;
  useEffect(() => {
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(px, py, pz + BODY_CENTER_Z));
    world.createCollider(rapier.ColliderDesc.cuboid(BODY_HALF[0], BODY_HALF[1], BODY_HALF[2]), body);
    return () => {
      world.removeRigidBody(body);
    };
  }, [world, rapier, px, py, pz]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onLockChange = () => {
      if (!document.pointerLockElement || timer !== null) return;
      timer = setTimeout(() => {
        powerOnTriggeredRef.current = true;
      }, delayMs);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [delayMs]);

  useFrame(({ clock }, dt) => {
    screenMaterial.uniforms.uTime.value = clock.elapsedTime;

    if (powerOnTriggeredRef.current && powerProgressRef.current < 1) {
      const progress = Math.min(1, powerProgressRef.current + (dt * 1000) / fadeMs);
      powerProgressRef.current = progress;
      const power = progress * progress * (3 - 2 * progress);
      CRT_POWER.value = power;
      if (lightRef.current) lightRef.current.intensity = CRT_GLOW.intensity * power;
      if (ledMatRef.current) ledMatRef.current.emissiveIntensity = 2 * power;
    }

    if (++frameRef.current % 3 !== 0) return;
    const screen = screenRef.current;
    if (!screen) return;
    let hover = false;
    if (powerOnTriggeredRef.current && camera.position.distanceTo(screen.getWorldPosition(_worldPos)) < HOVER_CHECK_DISTANCE) {
      _raycaster.setFromCamera(_center, camera);
      _raycaster.far = INTERACT_DISTANCE;
      const hit = _raycaster.intersectObject(screen, false)[0];
      _raycaster.far = Infinity;
      hover = !!hit;
      if (hit) hoverTarget.distance = hit.distance;
    }
    if (hover) claimHover(hoverTarget);
    else releaseHover(hoverTarget);
    screenMaterial.uniforms.uHover.value = hover ? 1 : 0;
  });

  return (
    <group position={position}>
      <mesh ref={screenRef}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <primitive object={screenMaterial} attach="material" />
      </mesh>
      <mesh position={[0, SCREEN_H / 2 + BEZEL / 2, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + BEZEL * 2, BEZEL, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[0, -(SCREEN_H / 2 + BEZEL / 2), FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + BEZEL * 2, BEZEL, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[-(SCREEN_W / 2 + BEZEL / 2), 0, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[BEZEL, SCREEN_H, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[SCREEN_W / 2 + BEZEL / 2, 0, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[BEZEL, SCREEN_H, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[0, 0, BACK_Z]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + 0.4, SCREEN_H + 0.6, BACK_DEPTH]} />
      </mesh>
      <mesh position={[SCREEN_W / 2 - 0.15, -(SCREEN_H / 2 + BEZEL / 2), FRAME_Z + FRAME_DEPTH / 2 + 0.02]}>
        <boxGeometry args={[0.12, 0.12, 0.04]} />
        <meshStandardMaterial ref={ledMatRef} color="#0a1a0a" emissive="#00ff44" emissiveIntensity={0} />
      </mesh>
      <pointLight ref={lightRef} position={CRT_GLOW.offset} color={CRT_GLOW.color} intensity={0} distance={CRT_GLOW.distance} decay={2} />
    </group>
  );
};
