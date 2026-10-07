import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createLampPostMaterial, getLampPostGeometry } from "./lampGeometry";
import { FREEWAY_LAMPS_SPEC, LAMP_COLLIDER_DISTANCE, LAMP_HEAD_OFFSET_X, LAMP_POLE_HEIGHT, STREET_LAMPS_SPEC } from "./lampSpec";
import { getWindowLightsProgress } from "../../../lighting/dayNight";
import { LAMP_COLOR_WARM, LAMP_EMISSIVE_STRENGTH, type LampHead, registerLampHeads } from "../../../lighting/lampGlow";
import { type ChunkWithPoints, instancedFromPoints, type SolidDressingProps, useDressingAssets, useSolidDressing } from "../Dressing";
import type { DressingColliderSpec } from "../types";

const DEFAULT_RENDER_DISTANCE = 440;
/** The glow source sits this far under the pole top, just below the head. */
const LAMP_GLOW_DROP = 0.6;

interface LampChunk extends ChunkWithPoints {
  releaseHeads: () => void;
}

type LampEnumerator = "densityPoints" | "freewayLamps";

interface LampPostsProps<K extends LampEnumerator> extends SolidDressingProps {
  spec: DressingColliderSpec<K>;
}

/** Every lamp post, whatever places it: one instanced chunk, its glow heads and its colliders from
 *  the spec. The drawn yaw IS the spec's body yaw, so a post and its collider can't disagree.
 *  No per-lamp edge fade: poles are thin enough to pop at range. */
const LampPosts = <K extends LampEnumerator>({ spec, renderDistance, colliderDistance }: LampPostsProps<K>) => {
  const assets = useDressingAssets(() => ({ material: createLampPostMaterial() }));

  const { content } = useSolidDressing<K, LampChunk>(spec, {
    renderDistance,
    defaultRenderDistance: DEFAULT_RENDER_DISTANCE,
    colliderDistance,
    defaultColliderDistance: LAMP_COLLIDER_DISTANCE,
    onRemove: (chunk) => chunk.releaseHeads(),
    build: (_points, bodies) => {
      const heads: LampHead[] = [];
      const mesh = instancedFromPoints(getLampPostGeometry(), assets.material, bodies, (b) => {
        heads.push({
          position: new THREE.Vector3(
            b.x + Math.cos(b.yaw) * LAMP_HEAD_OFFSET_X,
            b.y + LAMP_POLE_HEIGHT - LAMP_GLOW_DROP,
            b.z - Math.sin(b.yaw) * LAMP_HEAD_OFFSET_X
          ),
          color: LAMP_COLOR_WARM,
        });
        return b;
      });
      const group = new THREE.Group();
      group.add(mesh);
      return { group, releaseHeads: registerLampHeads(spec.id, heads) };
    },
  });

  useFrame(() => {
    const emissive = getWindowLightsProgress() * LAMP_EMISSIVE_STRENGTH;
    if (assets.material.emissiveIntensity !== emissive) assets.material.emissiveIntensity = emissive;
  });

  return content;
};

/** The city's sidewalk lamps (density-placed, LAMP_PLACEMENT). With FreewayLamps, the ONLY lamp art path. */
export const StreetLamps = (props: SolidDressingProps) => <LampPosts spec={STREET_LAMPS_SPEC} {...props} />;

/** Lamps along both sides of every inter-city freeway run (getFreewayRunLamps, FREEWAY_LAMP_PLACEMENT). */
export const FreewayLamps = (props: SolidDressingProps) => <LampPosts spec={FREEWAY_LAMPS_SPEC} {...props} />;
