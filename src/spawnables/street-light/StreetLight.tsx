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

// ---- Shared geometry + material template ----
// ONE merged low-poly mesh per lamp (base + pole + arm + head): part colors
// are baked as vertex colors, and an aLampMask attribute (1 on the head, 0
// elsewhere) gates the material's emissive so only the head glows — one draw
// call and one material per lamp instead of two of each.

let lampPostGeometry: THREE.BufferGeometry | null = null;

const paintPart = (g: THREE.BufferGeometry, hex: number, lampMask: number): THREE.BufferGeometry => {
  const color = new THREE.Color(hex);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  const mask = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
    mask[i] = lampMask;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  g.setAttribute("aLampMask", new THREE.BufferAttribute(mask, 1));
  g.deleteAttribute("uv");
  return g;
};

const getLampPostGeometry = (): THREE.BufferGeometry => {
  if (!lampPostGeometry) {
    const DARK = 0x2d3033;
    lampPostGeometry = mergeGeometries([
      paintPart(new THREE.BoxGeometry(0.5, 0.35, 0.5).translate(0, 0.18, 0), DARK, 0), // base
      paintPart(new THREE.BoxGeometry(0.22, POLE_HEIGHT, 0.22).translate(0, POLE_HEIGHT / 2, 0), DARK, 0), // pole
      paintPart(new THREE.BoxGeometry(1.5, 0.18, 0.18).translate(0.65, POLE_HEIGHT - 0.1, 0), DARK, 0), // arm
      paintPart(new THREE.BoxGeometry(0.85, 0.3, 0.45).translate(LAMP_ARM_X, POLE_HEIGHT - 0.35, 0), 0xd8d3c2, 1), // head
    ]);
  }
  return lampPostGeometry;
};

// Template: emissiveIntensity is driven per instance by the global
// window-lights progress, so all lamps fade in together at nightfall and out
// together at dawn (the ramp IS the fade — no per-lamp stagger, unlike
// windows). Cloned per lamp for the edge fade; every clone gets the same
// mask patch, so they all share one compiled shader program.
const LAMP_POST_MATERIAL = new THREE.MeshStandardMaterial({
  vertexColors: true,
  emissive: 0xffd166,
  emissiveIntensity: 0,
  roughness: 0.8,
  metalness: 0.05,
});

const patchLampMask = (material: THREE.MeshStandardMaterial): void => {
  material.customProgramCacheKey = () => "lamp-post";
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aLampMask;\nvarying float vLampMask;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvLampMask = aLampMask;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLampMask;")
      .replace(
        "#include <emissivemap_fragment>",
        "#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vLampMask;",
      );
  };
};

/**
 * Low-poly city street light. The lamp head glows via a masked emissive —
 * far brighter than building windows — following the global lights ramp
 * (simultaneous smooth fade at dusk/dawn). Actual illumination comes from
 * the lampGlow grid texture (terrain, buildings, doors, GLTF spawnables) —
 * see sky/lampGlow.ts. Opacity is tied directly to camera distance
 * (recomputed every frame) times a short mount ease-in, so lamps never pop.
 * Spawned by the spawn system (city only, high density); colliders mount
 * near the player.
 */
export const StreetLight = ({ id, coordinates, renderDistance, despawnDistance, onDestroy }: SpawnedObjectProps) => {
  const { camera } = useThree();
  const positionVec = useRef(new THREE.Vector3(...coordinates)).current;
  const collidersActiveRef = useRef(false);
  const [collidersActive, setCollidersActive] = useState(false);
  const appliedOpacityRef = useRef(-1);
  const mountFadeRef = useRef(0); // 0 → 1 over MOUNT_FADE_DURATION after mount

  // Per-instance material clone so this lamp can fade at the render edge
  // independently (clone() drops onBeforeCompile, so re-patch — the shared
  // cache key keeps all clones on one compiled shader program).
  const material = useMemo(() => {
    const m = LAMP_POST_MATERIAL.clone();
    patchLampMask(m);
    return m;
  }, []);
  useEffect(() => () => material.dispose(), [material]);

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
      // Last lamp gone → nobody drives the grid anymore; clear it (and the
      // shader early-out) so no ghost light pools linger on the terrain.
      if (activeLampHeads.size === 0) {
        updateLampGrid([], 0, 0);
        setLampGlowIntensity(0);
      }
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

    material.emissiveIntensity = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;
    if (opacity !== appliedOpacityRef.current) {
      appliedOpacityRef.current = opacity;
      material.opacity = opacity;
      material.transparent = opacity < 1;
    }
  });

  return (
    <group position={coordinates} rotation={[0, yaw, 0]}>
      <mesh geometry={getLampPostGeometry()} material={material} />
      {collidersActive && (
        <RigidBody type="fixed" colliders={false}>
          <CuboidCollider args={[0.12, POLE_HEIGHT / 2, 0.12]} position={[0, POLE_HEIGHT / 2, 0]} />
        </RigidBody>
      )}
    </group>
  );
};
