import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  getLampPostGeometry,
  LAMP_HEAD_OFFSET_X,
  LAMP_COLLIDER_DISTANCE,
  LAMP_POLE_HEIGHT,
  LAMP_POST_MATERIAL,
  lampYaw,
  patchLampMask,
} from "./lampGeometry";
import { LAMP_COLLIDER_PARTS, LAMP_PLACEMENT } from "./lampSpec";
import { getWindowLightsProgress } from "../../../lighting/dayNight";
import {
  activeLampHeads,
  driveLampLighting,
  LAMP_COLOR_WARM,
  LAMP_EMISSIVE_STRENGTH,
  markLampGridDirty,
  unregisterLampHeads,
} from "../../../lighting/lampGlow";
import {
  DressingPartColliders,
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  useDressingDefault,
} from "../Dressing";
import { DressingAttributes } from "../../types";
import { getDensityPoints } from "../dressingWorker";

const COLLIDER_SCAN_INTERVAL_FRAMES = 10;

interface LampChunk {
  group: THREE.Group;
  headKeys: string[];
  points: { x: number; y: number; z: number; yaw: number }[];
}

export interface StreetLampsProps extends DressingAttributes {}

/** The ONLY lamp path — a per-object lamp actor was removed as a duplicate implementation.
 *  No per-lamp edge fade: poles are thin enough to pop at range. */
export const StreetLamps = ({
  renderDistance,
  colliderDistance,
  density = LAMP_PLACEMENT.density,
  footprint = LAMP_PLACEMENT.footprint,
  roadDistanceRange = LAMP_PLACEMENT.roadDistanceRange,
  biomeIds = LAMP_PLACEMENT.biomeIds,
}: StreetLampsProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 440);
  const resolvedColliderDistance = useDressingDefault("colliderDistance", colliderDistance, LAMP_COLLIDER_DISTANCE);
  const { camera } = useThree();

  const registry = useChunkRegistry<LampChunk>((chunk) => unregisterLampHeads(chunk.headKeys));

  const assets = useDressingAssets(() => {
    const material = LAMP_POST_MATERIAL.clone();
    patchLampMask(material);
    return { material };
  });

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await getDensityPoints(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ, {
        seedTag: LAMP_PLACEMENT.seedTag,
        density,
        footprint,
        biomeIds,
        roadDistanceRange,
      });
      if (points.length === 0) return null;

      const headKeys: string[] = [];
      const colliderPoints: { x: number; y: number; z: number; yaw: number }[] = [];
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, points, (p) => {
        const yaw = lampYaw(p.x, p.z);
        colliderPoints.push({ x: p.x, y: p.y, z: p.z, yaw });
        const key = `sli_${p.x}_${p.z}`;
        activeLampHeads.set(key, {
          position: new THREE.Vector3(
            p.x + Math.cos(yaw) * LAMP_HEAD_OFFSET_X,
            p.y + LAMP_POLE_HEIGHT - 0.6,
            p.z - Math.sin(yaw) * LAMP_HEAD_OFFSET_X
          ),
          color: LAMP_COLOR_WARM,
        });
        headKeys.push(key);
        return { x: p.x, y: p.y, z: p.z, yaw };
      });

      const group = new THREE.Group();
      group.add(mesh);
      registry.add({ group, headKeys, points: colliderPoints });
      markLampGridDirty();
      return group;
    },
  });

  const colliders = useDressingColliders(registry, {
    colliderDistance: resolvedColliderDistance,
    scanIntervalFrames: COLLIDER_SCAN_INTERVAL_FRAMES,
  });

  useFrame((state) => {
    driveLampLighting(camera, state.clock.elapsedTime);
    const emissive = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;
    if (assets.material.emissiveIntensity !== emissive) assets.material.emissiveIntensity = emissive;
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the lamps near the player. */}
      <DressingPartColliders colliders={colliders} parts={LAMP_COLLIDER_PARTS} />
    </>
  );
};
