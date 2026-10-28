import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createLampPostMaterial, getLampPostGeometry } from "./geometry";
import {
  FREEWAY_LAMPS,
  FREEWAY_LAMPS_SPEC,
  LAMP_COLLIDER_DISTANCE,
  LAMP_HEAD_OFFSET_X,
  LAMP_POLE_HEIGHT,
  STREET_LAMPS,
  STREET_LAMPS_SPEC,
} from "./spec";
import { declare } from "../../../world/content";
import { featureMounts } from "../../../utils/workers/biomeFlags";
import { farthest } from "../utils";
import { getWindowLightsProgress } from "../../../lighting/dayNight";
import { LAMP_COLOR_WARM, LAMP_EMISSIVE_STRENGTH, type LampHead, registerLampHeads } from "../../../lighting/lampGlow";
import { type ChunkWithPoints, instancedFromPoints, type SolidDressingProps, useChunkAssets, useSolidDressing } from "..";
import type { DressingColliderSpec } from "../types";

const DEFAULT_RENDER_DISTANCE = 440;
/** The glow source sits this far under the pole top, just below the head. */
const LAMP_GLOW_DROP = 0.6;

interface LampChunk extends ChunkWithPoints {
  releaseHeads: () => void;
}

type LampEnumerator = "densityPoints" | "freewayLamps";

interface LampPostsProps<K extends LampEnumerator> {
  spec: DressingColliderSpec<K>;
  kind: string;
}

/** Every lamp post, whatever places it: one instanced chunk, its glow heads and its colliders from
 *  the spec. The drawn yaw IS the spec's body yaw, so a post and its collider can't disagree.
 *  No per-lamp edge fade: poles are thin enough to pop at range. */
const LampPosts = <K extends LampEnumerator>({ spec, kind }: LampPostsProps<K>) => {
  const mounts = featureMounts<SolidDressingProps>(kind);
  const assets = useChunkAssets(() => ({ material: createLampPostMaterial() }));

  const { content } = useSolidDressing<K, LampChunk>(spec, {
    renderDistance: farthest(mounts, "renderDistance", DEFAULT_RENDER_DISTANCE),
    colliderDistance: farthest(mounts, "colliderDistance", LAMP_COLLIDER_DISTANCE),
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

/** LAMPS along the sidewalks of the biome this is mounted in (density-placed on its road field's
 *  sidewalk band). One driver draws every mount: chunks are world-space. */
export const StreetLamps = declare<SolidDressingProps>({
  kind: STREET_LAMPS,
  within: "biome",
  read: (node) => ({ ...node.props }),
  Driver: () => <LampPosts spec={STREET_LAMPS_SPEC} kind={STREET_LAMPS} />,
});

/** LAMPS along both sides of every inter-city freeway run leaving the biome this is mounted in —
 *  the runs are its infrastructure, and they cross open country between cities. */
export const FreewayLamps = declare<SolidDressingProps>({
  kind: FREEWAY_LAMPS,
  within: "biome",
  read: (node) => ({ ...node.props }),
  Driver: () => <LampPosts spec={FREEWAY_LAMPS_SPEC} kind={FREEWAY_LAMPS} />,
});
