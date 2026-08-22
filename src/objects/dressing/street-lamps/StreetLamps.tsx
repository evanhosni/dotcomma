import { useFrame, useThree } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import {
  getLampPostGeometry,
  LAMP_ARM_X,
  LAMP_COLLIDER_DISTANCE,
  LAMP_PARTS,
  LAMP_POLE_HEIGHT,
  LAMP_POST_MATERIAL,
  lampYaw,
  patchLampMask,
} from "./lampGeometry";
import { getWindowLightsProgress } from "../../../lighting/dayNight";
import {
  activeLampHeads,
  clearLampGridIfEmpty,
  driveLampLighting,
  LAMP_COLOR_WARM,
  LAMP_EMISSIVE_STRENGTH,
  markLampGridDirty,
} from "../../../lighting/lampGlow";
import {
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  useDressingRenderDistance,
} from "../Dressing";
import { DensityPlacement, GameObjectAttributes } from "../../types";
import { getDensityPoints } from "../dressingWorker";

const COLLIDER_SCAN_INTERVAL_FRAMES = 10;

interface LampChunk {
  group: THREE.Group;
  headKeys: string[];
  /** Lamp bases WITH their yaw — the collider scan's input. The arm and head
   *  are off-axis, so their colliders need the same yaw the instance was drawn
   *  with (see useDressingColliders). */
  points: { x: number; y: number; z: number; yaw: number }[];
}

export interface StreetLampsProps extends GameObjectAttributes, DensityPlacement {
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
 * DRESSING: instanced street lights — the ONLY lamp path (a per-object lamp
 * ACTOR existed alongside this and was removed: a lamp is mass, identical,
 * stateless scenery, which is the definition of dressing, and the duplicate
 * meant every piece of shared object logic had to be applied twice). One
 * InstancedMesh per chunk sharing ONE aLampMask-patched material. It keeps
 * everything that matters:
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
      const colliderPoints: { x: number; y: number; z: number; yaw: number }[] = [];
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, points, (p) => {
        const yaw = lampYaw(p.x, p.z);
        colliderPoints.push({ x: p.x, y: p.y, z: p.z, yaw });
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
      registry.add({ group, headKeys, points: colliderPoints });
      markLampGridDirty(); // new heads registered above
      return group;
    },
  });

  // Real colliders for the few lamps near the player. The scan (and the
  // registry's prune sweep, which is what unregisters departed lamp heads) lives
  // in the base — traffic lights and power-line posts do exactly the same thing,
  // and this used to be ~55 lines duplicated here.
  const colliders = useDressingColliders(registry, {
    distance: LAMP_COLLIDER_DISTANCE,
    scanIntervalFrames: COLLIDER_SCAN_INTERVAL_FRAMES,
  });

  useFrame((state) => {
    // Shared lighting driver + the global night ramp (one write for all lamps).
    driveLampLighting(camera, state.clock.elapsedTime);
    assets.material.emissiveIntensity = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Pole, arm and head, all solid. The body carries the lamp's yaw so the
          off-axis arm and head line up with the instance that's drawn; box sizes
          come from LAMP_PARTS, the same numbers the geometry is built from. */}
      {colliders.map((c) => (
        <RigidBody
          key={c.key}
          type="fixed"
          colliders={false}
          position={[c.x, c.y, c.z]}
          rotation={[0, c.yaw, 0]}
        >
          {/* Slightly proud of the 0.22u pole so its corner can't be clipped. */}
          <CuboidCollider
            args={[0.12, LAMP_POLE_HEIGHT / 2, 0.12]}
            position={[0, LAMP_POLE_HEIGHT / 2, 0]}
          />
          <CuboidCollider
            args={[LAMP_PARTS.arm.w / 2, LAMP_PARTS.arm.h / 2, LAMP_PARTS.arm.d / 2]}
            position={[LAMP_PARTS.arm.x, LAMP_PARTS.arm.y, 0]}
          />
          <CuboidCollider
            args={[LAMP_PARTS.head.w / 2, LAMP_PARTS.head.h / 2, LAMP_PARTS.head.d / 2]}
            position={[LAMP_PARTS.head.x, LAMP_PARTS.head.y, 0]}
          />
        </RigidBody>
      ))}
    </>
  );
};
