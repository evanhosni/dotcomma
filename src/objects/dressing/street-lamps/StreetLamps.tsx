import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  getLampPostGeometry,
  LAMP_HEAD_OFFSET_X,
  LAMP_COLLIDER_DISTANCE,
  LAMP_POLE_HEIGHT,
  LAMP_POST_MATERIAL,
  patchLampMask,
} from "./lampGeometry";
import { FREEWAY_LAMPS_SPEC, STREET_LAMPS_SPEC } from "./lampSpec";
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
import type { DressingColliderSpec } from "../types";

const DEFAULTS = STREET_LAMPS_SPEC.placement;
const DEFAULT_RENDER_DISTANCE = 440;

interface LampChunk extends ChunkWithPoints {
  releaseHeads: () => void;
}

type LampEnumerator = "densityPoints" | "freewayLamps";

interface LampPostsProps<K extends LampEnumerator> {
  spec: DressingColliderSpec<K>;
  placement: DressingColliderSpec<K>["placement"];
  renderDistance?: number;
  colliderDistance?: number;
}

/** Every lamp post, whatever places it: one instanced chunk, its glow heads and its colliders from
 *  the spec. The drawn yaw IS the spec's body yaw, so a post and its collider can't disagree.
 *  No per-lamp edge fade: poles are thin enough to pop at range. */
const LampPosts = <K extends LampEnumerator>({ spec, placement, renderDistance, colliderDistance }: LampPostsProps<K>) => {
  const resolvedDistance = useDressingDefault("renderDistance", renderDistance, DEFAULT_RENDER_DISTANCE);
  const resolvedColliderDistance = useDressingDefault("colliderDistance", colliderDistance, LAMP_COLLIDER_DISTANCE);
  useServerPlacementCheck(spec, placement);

  const registry = useChunkRegistry<LampChunk>((chunk) => chunk.releaseHeads());

  const assets = useDressingAssets(() => {
    const material = LAMP_POST_MATERIAL.clone();
    patchLampMask(material);
    return { material };
  });

  const groupRef = useDressingChunks({
    renderDistance: resolvedDistance,
    build: async (bounds) => {
      const points = await enumerateDressing(spec.enumerator, bounds, placement);
      if (points.length === 0) return null;

      const heads: LampHead[] = [];
      const bodies = points.flatMap(spec.bodiesOf);
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, bodies, (b) => {
        heads.push({
          position: new THREE.Vector3(
            b.x + Math.cos(b.yaw) * LAMP_HEAD_OFFSET_X,
            b.y + LAMP_POLE_HEIGHT - 0.6,
            b.z - Math.sin(b.yaw) * LAMP_HEAD_OFFSET_X
          ),
          color: LAMP_COLOR_WARM,
        });
        return b;
      });

      const group = new THREE.Group();
      group.add(mesh);
      const releaseHeads = registerLampHeads(spec.id, heads);
      registry.add({ group, releaseHeads, points: bodies });
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
      <DressingPartColliders colliders={colliders} parts={spec.colliderParts} />
    </>
  );
};

export interface StreetLampsProps extends DressingAttributes {}

/** The city's sidewalk lamps (density-placed). The ONLY lamp art path, with FreewayLamps — a
 *  per-object lamp actor was removed as a duplicate implementation. */
export const StreetLamps = ({
  renderDistance,
  colliderDistance,
  density = DEFAULTS.density,
  footprint = DEFAULTS.footprint,
  roadDistanceRange = DEFAULTS.roadDistanceRange,
  biomeIds = DEFAULTS.biomeIds,
  heightRange,
  slopeRange,
}: StreetLampsProps) => (
  <LampPosts
    spec={STREET_LAMPS_SPEC}
    placement={{ ...DEFAULTS, density, footprint, roadDistanceRange, biomeIds, heightRange, slopeRange }}
    renderDistance={renderDistance}
    colliderDistance={colliderDistance}
  />
);

export interface FreewayLampsProps extends Pick<DressingAttributes, "renderDistance" | "colliderDistance"> {}

/** Lamps along both sides of every inter-city freeway run (getFreewayRunLamps; tune its placement in
 *  FREEWAY_LAMP_PLACEMENT — the server builds the colliders from the spec). */
export const FreewayLamps = ({ renderDistance, colliderDistance }: FreewayLampsProps) => (
  <LampPosts spec={FREEWAY_LAMPS_SPEC} placement={FREEWAY_LAMPS_SPEC.placement} renderDistance={renderDistance} colliderDistance={colliderDistance} />
);
