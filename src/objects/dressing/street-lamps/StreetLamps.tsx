import { useFrame } from "@react-three/fiber";
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
import { STREET_LAMPS_SPEC } from "./lampSpec";
import { getWindowLightsProgress } from "../../../lighting/dayNight";
import { LAMP_COLOR_WARM, LAMP_EMISSIVE_STRENGTH, type LampHead, registerLampHeads } from "../../../lighting/lampGlow";
import {
  type ChunkWithPoints,
  DressingPartColliders,
  instancedFromPoints,
  useChunkRegistry,
  useDressingAssets,
  useDressingChunks,
  useDressingColliders,
  useDressingDefault,
  useServerPlacementCheck,
} from "../Dressing";
import { DressingAttributes } from "../../types";
import { enumerateDressing } from "../dressingWorker";

const DEFAULTS = STREET_LAMPS_SPEC.placement;

interface LampChunk extends ChunkWithPoints {
  releaseHeads: () => void;
}

export interface StreetLampsProps extends DressingAttributes {}

/** The ONLY lamp path — a per-object lamp actor was removed as a duplicate implementation.
 *  No per-lamp edge fade: poles are thin enough to pop at range. */
export const StreetLamps = ({
  renderDistance,
  colliderDistance,
  density = DEFAULTS.density,
  footprint = DEFAULTS.footprint,
  roadDistanceRange = DEFAULTS.roadDistanceRange,
  biomeIds = DEFAULTS.biomeIds,
  heightRange,
  slopeRange,
}: StreetLampsProps) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, 440);
  const resolvedColliderDistance = useDressingDefault("colliderDistance", colliderDistance, LAMP_COLLIDER_DISTANCE);
  const placement = { ...DEFAULTS, density, footprint, roadDistanceRange, biomeIds, heightRange, slopeRange };
  useServerPlacementCheck(STREET_LAMPS_SPEC, placement);

  const registry = useChunkRegistry<LampChunk>((chunk) => chunk.releaseHeads());

  const assets = useDressingAssets(() => {
    const material = LAMP_POST_MATERIAL.clone();
    patchLampMask(material);
    return { material };
  });

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await enumerateDressing(STREET_LAMPS_SPEC.enumerator, bounds, placement);
      if (points.length === 0) return null;

      const heads: LampHead[] = [];
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, points, (p) => {
        const yaw = lampYaw(p.x, p.z);
        heads.push({
          position: new THREE.Vector3(
            p.x + Math.cos(yaw) * LAMP_HEAD_OFFSET_X,
            p.y + LAMP_POLE_HEIGHT - 0.6,
            p.z - Math.sin(yaw) * LAMP_HEAD_OFFSET_X
          ),
          color: LAMP_COLOR_WARM,
        });
        return { x: p.x, y: p.y, z: p.z, yaw };
      });

      const group = new THREE.Group();
      group.add(mesh);
      const releaseHeads = registerLampHeads("street-lamps", heads);
      registry.add({ group, releaseHeads, points: points.flatMap(STREET_LAMPS_SPEC.bodiesOf) });
      return group;
    },
  });

  const colliders = useDressingColliders(registry, { colliderDistance: resolvedColliderDistance });

  useFrame(() => {
    const emissive = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;
    if (assets.material.emissiveIntensity !== emissive) assets.material.emissiveIntensity = emissive;
  });

  return (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the lamps near the player. */}
      <DressingPartColliders colliders={colliders} parts={STREET_LAMPS_SPEC.colliderParts} />
    </>
  );
};
