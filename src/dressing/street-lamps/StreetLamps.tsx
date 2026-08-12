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
import { LAMP_COLOR_WARM, markLampGridDirty } from "../../sky/lampGlow";
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
  // Last full collider scan: camera position + alive-chunk-set signature
  // (skip gate) and the in-range lamp set's numeric signature (state-update
  // change detection) — all cheap number compares, no string joins.
  const lastScanRef = useRef({
    x: Infinity,
    z: Infinity,
    chunkCount: -1,
    pointCount: -1,
    colliderCount: -1,
    colliderHash: 0,
  });
  const aliveScratchRef = useRef<LampChunk[]>([]);

  const registry = useChunkRegistry<LampChunk>((chunk) => {
    for (const key of chunk.headKeys) activeLampHeads.delete(key);
    markLampGridDirty(); // heads left the set — next grid rewrite must run
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
      markLampGridDirty(); // new heads registered above
      return group;
    },
  });

  useFrame((state) => {
    // Shared lighting driver + the global night ramp (one write for all lamps).
    driveLampLighting(camera, state.clock.elapsedTime);
    assets.material.emissiveIntensity = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;

    // Colliders for the few lamps near the player.
    if (frameCount.current++ % COLLIDER_SCAN_INTERVAL_FRAMES !== 0) return;

    // The registry sweep must run EVERY interval even when the scan below is
    // skipped — forEachAlive is what prunes unmounted chunks and unregisters
    // their lamp heads. Collect alive chunks + a cheap chunk-set signature
    // (count + total points) while at it.
    const alive = aliveScratchRef.current;
    alive.length = 0;
    let pointCount = 0;
    registry.forEachAlive((chunk) => {
      alive.push(chunk);
      pointCount += chunk.points.length;
    });

    // Skip the per-lamp distance scan when the camera has moved < 2u since
    // the last scan and the alive chunk set is unchanged — nothing can have
    // entered or left collider range.
    const last = lastScanRef.current;
    const movedSq =
      (camera.position.x - last.x) ** 2 + (camera.position.z - last.z) ** 2;
    if (movedSq < 4 && alive.length === last.chunkCount && pointCount === last.pointCount) {
      alive.length = 0;
      return;
    }
    last.x = camera.position.x;
    last.z = camera.position.z;
    last.chunkCount = alive.length;
    last.pointCount = pointCount;

    const near: { key: string; x: number; y: number; z: number }[] = [];
    let hash = 0;
    const maxDistSq = LAMP_COLLIDER_DISTANCE * LAMP_COLLIDER_DISTANCE;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          near.push({ key: `${p.x}_${p.z}`, x: p.x, y: p.y, z: p.z });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
    alive.length = 0;
    // Numeric change detection (coords are deterministic, so equal
    // sum + count means the same lamp set) instead of a joined key string.
    if (near.length !== last.colliderCount || hash !== last.colliderHash) {
      last.colliderCount = near.length;
      last.colliderHash = hash;
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
