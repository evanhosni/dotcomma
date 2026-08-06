import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { SpawnedObjectProps } from "../../objects/spawning/types";
import { getWindowLightsProgress } from "../../sky/dayNight";
import { setLampGlowIntensity, updateLampGrid } from "../../sky/lampGlow";
import { getDistance2D } from "../../utils/utils";

const DESPAWN_BUFFER = 1.2;
const FADE_BAND = 40; // world units before renderDistance over which lamps fade
const MOUNT_FADE_DURATION = 0.8; // s — spawn chunks can mount lamps mid-band, so every mount eases in from 0
const COLLIDER_DISTANCE = 60;
const POLE_HEIGHT = 10.8;
const LAMP_ARM_X = 1.25; // lamp head offset along the arm
/** Lamp glow at full night — windows sit around 1.4, street lights burn much
 *  brighter. Scales each lamp material's emissiveIntensity. */
const LAMP_EMISSIVE_STRENGTH = 12;

// ---- Lamp lighting ----
// ALL lamp light comes from the lamp-grid data texture (sky/lampGlow.ts):
// EVERY mounted lamp head lights the terrain, buildings, doors, and GLTF
// spawnables (their materials are patched) with a cheap shader falloff —
// 9 texture reads per fragment, constant cost regardless of lamp count.
// No real point lights at all: nothing depends on the player's distance, so
// a lamp's light can never visibly "turn on" as you approach.
const GRID_UPDATE_INTERVAL = 20; // frames between lamp-grid rewrites

/** World-space lamp-head positions of every mounted street light. */
const activeLampHeads = new Map<string, THREE.Vector3>();

// Shared per-frame driver — the FIRST lamp instance to run each frame does
// the global work (same pattern as GameObject's shared frustum update), so
// no separately mounted system component is needed.
let lampDriveTime = -1;
let lampDriveFrame = 0;
const driveLampLighting = (camera: THREE.Camera, time: number): void => {
  if (time === lampDriveTime) return;
  lampDriveTime = time;
  setLampGlowIntensity(getWindowLightsProgress());
  if (lampDriveFrame++ % GRID_UPDATE_INTERVAL === 0) {
    updateLampGrid(activeLampHeads.values(), camera.position.x, camera.position.z);
  }
};

// ---- Shared geometry + material templates (cloned per lamp for the edge
// fade — clones share the same shader program, so this stays one compile) ----
// Low-poly L-shape: base + pole + arm, with a boxy lamp head hanging at the
// arm's end. Dark parts and the lamp are separate meshes so the lamp can glow.

let darkGeometry: THREE.BufferGeometry | null = null;
let lampGeometry: THREE.BufferGeometry | null = null;

const getDarkGeometry = (): THREE.BufferGeometry => {
  if (!darkGeometry) {
    darkGeometry = mergeGeometries([
      new THREE.BoxGeometry(0.5, 0.35, 0.5).translate(0, 0.18, 0), // base
      new THREE.BoxGeometry(0.22, POLE_HEIGHT, 0.22).translate(0, POLE_HEIGHT / 2, 0), // pole
      new THREE.BoxGeometry(1.5, 0.18, 0.18).translate(0.65, POLE_HEIGHT - 0.1, 0), // arm
    ]);
  }
  return darkGeometry;
};

const getLampGeometry = (): THREE.BufferGeometry => {
  if (!lampGeometry) {
    lampGeometry = new THREE.BoxGeometry(0.85, 0.3, 0.45).translate(LAMP_ARM_X, POLE_HEIGHT - 0.35, 0);
  }
  return lampGeometry;
};

const POLE_MATERIAL = new THREE.MeshStandardMaterial({ color: 0x2d3033, roughness: 0.9, metalness: 0.1 });
// Lamp template: emissiveIntensity is driven by the global window-lights
// progress, so all lamps fade in together at nightfall and out together at
// dawn (the ramp IS the fade — no per-lamp stagger, unlike windows).
const LAMP_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xd8d3c2,
  emissive: 0xffd166,
  emissiveIntensity: 0,
  roughness: 0.6,
  metalness: 0,
});

/**
 * Low-poly city street light. The lamp head glows via its emissive material —
 * far brighter than building windows — following the global lights ramp
 * (simultaneous smooth fade at dusk/dawn). Actual illumination comes from the
 * lampGlow shader channel (terrain, buildings, doors) plus a tiny real
 * point-light pool for NPCs — see StreetLightPool. Opacity is tied directly
 * to camera distance (recomputed every frame), so entering/leaving render
 * distance is a perfectly smooth fade. Spawned by the spawn system (city
 * only, high density); colliders mount near the player.
 */
export const StreetLight = ({ id, coordinates, renderDistance, despawnDistance, onDestroy }: SpawnedObjectProps) => {
  const { camera } = useThree();
  const positionVec = useRef(new THREE.Vector3(...coordinates)).current;
  const collidersActiveRef = useRef(false);
  const [collidersActive, setCollidersActive] = useState(false);
  const appliedOpacityRef = useRef(-1);
  const mountFadeRef = useRef(0); // 0 → 1 over MOUNT_FADE_DURATION after mount

  // Per-instance material clones so this lamp can fade at the render edge
  // independently (clones reuse the template's compiled shader program).
  const materials = useMemo(() => ({ pole: POLE_MATERIAL.clone(), lamp: LAMP_MATERIAL.clone() }), []);
  useEffect(
    () => () => {
      materials.pole.dispose();
      materials.lamp.dispose();
    },
    [materials],
  );

  // Deterministic yaw from the spawn position, so each lamp faces its own way
  // (and the same way on every load).
  const yaw = useMemo(
    () => (Math.abs(coordinates[0] * 7.13 + coordinates[2] * 3.71) % 6.283) as number,
    [coordinates],
  );

  // Register this lamp's head position for the lighting grid.
  useEffect(() => {
    const head = new THREE.Vector3(
      coordinates[0] + Math.cos(yaw) * LAMP_ARM_X,
      coordinates[1] + POLE_HEIGHT - 0.6,
      coordinates[2] - Math.sin(yaw) * LAMP_ARM_X,
    );
    activeLampHeads.set(id, head);
    return () => {
      activeLampHeads.delete(id);
      // Last lamp gone → nobody drives the grid anymore; clear it so no
      // ghost light pools linger on the terrain.
      if (activeLampHeads.size === 0) updateLampGrid([], 0, 0);
    };
  }, [id, coordinates, yaw]);

  useFrame((state, delta) => {
    // Shared lighting driver — first lamp per frame does the global work
    driveLampLighting(camera, state.clock.elapsedTime);

    // Everything runs every frame — the edge fade is a direct function of
    // distance, so it's smooth at any movement speed.
    const distance = getDistance2D(camera.position, positionVec);

    if (distance > (despawnDistance ?? renderDistance * DESPAWN_BUFFER)) {
      onDestroy(id);
      return;
    }
    const shouldCollide = distance < COLLIDER_DISTANCE;
    if (shouldCollide !== collidersActiveRef.current) {
      collidersActiveRef.current = shouldCollide;
      setCollidersActive(shouldCollide);
    }

    // Distance fade: 1 inside (renderDistance - FADE_BAND), 0 at renderDistance.
    // Multiplied by a short mount fade — spawn CHUNKS can mount a lamp deep
    // inside the band, and without this it would pop in at full opacity.
    mountFadeRef.current = Math.min(1, mountFadeRef.current + delta / MOUNT_FADE_DURATION);
    const t = Math.min(Math.max((distance - (renderDistance - FADE_BAND)) / FADE_BAND, 0), 1);
    const opacity = (1 - t * t * (3 - 2 * t)) * mountFadeRef.current; // smoothstep × ease-in

    const progress = getWindowLightsProgress();
    const { pole, lamp } = materials;
    lamp.emissiveIntensity = progress * LAMP_EMISSIVE_STRENGTH;
    if (opacity !== appliedOpacityRef.current) {
      appliedOpacityRef.current = opacity;
      pole.opacity = opacity;
      pole.transparent = opacity < 1;
      lamp.opacity = opacity;
      lamp.transparent = opacity < 1;
    }
  });

  return (
    <group position={coordinates} rotation={[0, yaw, 0]}>
      <mesh geometry={getDarkGeometry()} material={materials.pole} />
      <mesh geometry={getLampGeometry()} material={materials.lamp} />
      {collidersActive && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[0.12, POLE_HEIGHT / 2, 0.12]} position={[0, POLE_HEIGHT / 2, 0]} />
        </RigidBody>
      )}
    </group>
  );
};
