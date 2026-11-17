import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createLampPostMaterial } from "./material";
import { getLampPostGeometry } from "./geometry";
import { LAMP_COLLIDER_DISTANCE, LAMP_HEAD_OFFSET_X, LAMP_POLE_HEIGHT } from "./spec";
import { featureMounts } from "../../../generation/registry";
import { farthest } from "../utils";
import { getWindowLightsProgress } from "../../../lighting/day-night/store";
import { LAMP_COLOR_WARM } from "../../../lighting/lamp-glow/enums";
import { LAMP_EMISSIVE_STRENGTH } from "../../../lighting/lamp-glow/constants";
import type { LampHead } from "../../../lighting/lamp-glow/types";
import { registerLampHeads } from "../../../lighting/lamp-glow";
import type { ChunkWithPoints } from "../hooks";
import { useChunkAssets, useSolidDressing } from "../hooks";
import { instancedFromPoints } from "../geometry";
import type { SolidDressingProps, DressingColliderSpec } from "../types";

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
export const LampPosts = <K extends LampEnumerator>({ spec, kind }: LampPostsProps<K>) => {
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
