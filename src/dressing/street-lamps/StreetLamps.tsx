import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import { useRef, useState } from "react";
import * as THREE from "three";
import {
  activeLampHeads,
  clearLampGridIfEmpty,
  driveLampLighting,
  getLampPostGeometry,
  LAMP_ARM_X,
  LAMP_COLLIDER_DISTANCE,
  LAMP_EMISSIVE_STRENGTH,
  LAMP_POLE_HEIGHT,
  LAMP_POST_MATERIAL,
  lampYaw,
  patchLampMask,
} from "../../actors/street-lamp/StreetLamp";
import { getWindowLightsProgress } from "../../sky/dayNight";
import { LAMP_COLOR_WARM } from "../../sky/lampGlow";
import {
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingRenderDistance,
} from "../Dressing";
import { DensityPoint, getDensityPoints } from "../dressingWorker";

const COLLIDER_SCAN_INTERVAL_FRAMES = 10;

interface LampChunk {
  group: THREE.Group;
  headKeys: string[];
  points: DensityPoint[];
}

export interface StreetLampsProps {
  renderDistance?: number;
  /** Lamps per 1,000,000 sq units of candidate area (the sidewalk band is
   *  thin, so this is set high — footprint spacing is the real limiter). */
  density?: number;
  /** Min spacing between lamps along a sidewalk. */
  footprint?: number;
  /** Road-field band lamps may stand on (default: the sidewalk). */
  roadDistanceRange?: [number, number];
}

/**
 * DRESSING: instanced street lights — the city's lamp path (the per-object
 * street-lamp ACTOR in src/actors/street-lamp remains for other uses; its
 * geometry/material/lighting exports are shared here so both look
 * identical). One InstancedMesh per chunk sharing ONE aLampMask-patched
 * material. Keeps everything that matters:
 *   - lamp-grid lighting: every mounted lamp's head registers in
 *     activeLampHeads, so terrain/buildings still receive its glow;
 *   - night emissive ramp: material intensity driven once per frame (all
 *     lamps ramp together anyway);
 *   - colliders: real cuboid colliders mount for the handful of lamps within
 *     LAMP_COLLIDER_DISTANCE of the camera (scanned every few frames).
 * Dropped: the per-lamp edge fade (poles are thin enough to pop at range).
 */
export const StreetLamps = ({
  renderDistance,
  density = 4200,
  footprint = 14,
  roadDistanceRange = [8.2, 11.8],
}: StreetLampsProps) => {
  const resolvedDistance = useDressingRenderDistance(renderDistance, 440);
  const { camera } = useThree();
  const frameCount = useRef(0);
  const [colliders, setColliders] = useState<{ key: string; x: number; y: number; z: number }[]>(
    []
  );
  const colliderKeysRef = useRef("");

  const registry = useChunkRegistry<LampChunk>((chunk) => {
    for (const key of chunk.headKeys) activeLampHeads.delete(key);
    clearLampGridIfEmpty();
  });

  // ONE material for every chunk (no per-lamp fade → no clones needed); the
  // shared cache key keeps it on the same compiled program as the actor's.
  const assets = useDressingAssets(() => {
    const material = LAMP_POST_MATERIAL.clone();
    patchLampMask(material);
    return { material };
  });

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await getDensityPoints(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ, {
        seedTag: "street-lamp-i",
        density,
        footprint,
        biomeIds: [1],
        roadDistanceRange,
      });
      if (points.length === 0) return null;

      const headKeys: string[] = [];
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, points, (p) => {
        const yaw = lampYaw(p.x, p.z);
        // Register the head for the lamp-grid lighting (same as the actor).
        const key = `sli_${p.x}_${p.z}`;
        activeLampHeads.set(key, {
          position: new THREE.Vector3(
            p.x + Math.cos(yaw) * LAMP_ARM_X,
            p.y + LAMP_POLE_HEIGHT - 0.6,
            p.z - Math.sin(yaw) * LAMP_ARM_X
          ),
          color: LAMP_COLOR_WARM,
        });
        headKeys.push(key);
        return { x: p.x, y: p.y, z: p.z, yaw };
      });

      const group = new THREE.Group();
      group.add(mesh);
      registry.add({ group, headKeys, points });
      return group;
    },
  });

  useFrame((state) => {
    // Shared lighting driver + the global night ramp (one write for all lamps).
    driveLampLighting(camera, state.clock.elapsedTime);
    assets.material.emissiveIntensity = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;

    // Colliders for the few lamps near the player (registry iteration also
    // prunes unmounted chunks, unregistering their lamp heads).
    if (frameCount.current++ % COLLIDER_SCAN_INTERVAL_FRAMES !== 0) return;
    const near: { key: string; x: number; y: number; z: number }[] = [];
    const maxDistSq = LAMP_COLLIDER_DISTANCE * LAMP_COLLIDER_DISTANCE;
    registry.forEachAlive((chunk) => {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) near.push({ key: `${p.x}_${p.z}`, x: p.x, y: p.y, z: p.z });
      }
    });
    const keys = near.map((n) => n.key).join("|");
    if (keys !== colliderKeysRef.current) {
      colliderKeysRef.current = keys;
      setColliders(near);
    }
  });

  return (
    <>
      <group ref={groupRef} />
      {colliders.map((c) => (
        <RigidBody key={c.key} type="fixed" colliders={false} position={[c.x, c.y, c.z]}>
          <CuboidCollider
            args={[0.12, LAMP_POLE_HEIGHT / 2, 0.12]}
            position={[0, LAMP_POLE_HEIGHT / 2, 0]}
          />
        </RigidBody>
      ))}
    </>
  );
};
