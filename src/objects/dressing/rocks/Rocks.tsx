import { traceSpan } from "../../../utils/spike-trace";
import * as THREE from "three";
import { meshTemplate } from "../../../utils/render";
import { selfPatchedMaterial, useChunkAssets, useSolidDressing } from "../hooks";
import { type SolidDressingProps } from "../types";
import { ROCK_COLLIDER_DISTANCE, ROCK_RENDER_DISTANCE, ROCKS_SPEC } from "./spec";
import { buildRockMesh } from "./geometry";
import { createRockMaterial } from "./material";
import { declare } from "../../../world/content";
import { featureMounts } from "../../../generation/registry";
import { ROCK_DEFAULTS, ROCKS } from "../../../generation/rocks/params";
import type { RockParams } from "../../../generation/rocks/types";
import { farthest } from "../utils";

/**
 * ROCKS: one merged, flat-shaded mesh per chunk (geometry.ts: every lump baked in place, its shade as a
 * vertex attribute, rebased on the chunk's middle) in the rock look (material.ts); a trimesh collider per
 * lump near the player, built by the same spec on the server (spec.ts). Waterfall boulders draw with the
 * same art (waterfall-boulders/).
 */

export interface RocksProps extends SolidDressingProps, Partial<RockParams> {}

/** ROCKS strewn over the biome this is mounted in, by slope: steeper ground keeps more. Every
 *  mount is one density field of its own (its props over ROCK_DEFAULTS), and this one driver draws
 *  them all — chunks are world-space, so a driver per mount would build each one twice. */
export const Rocks = declare<RocksProps>({
  kind: ROCKS,
  within: "biome",
  read: (node) => ({ ...ROCK_DEFAULTS, ...node.props }),
  Driver: () => <RocksDriver />,
});

const RocksDriver = () => {
  const mounts = featureMounts<RocksProps>(ROCKS);
  const renderDistance = farthest(mounts, "renderDistance", ROCK_RENDER_DISTANCE);
  const colliderDistance = farthest(mounts, "colliderDistance", ROCK_COLLIDER_DISTANCE);
  const assets = useChunkAssets(
    () => ({ rock: selfPatchedMaterial(createRockMaterial()) }),
    (a) => [meshTemplate(a.rock.material)],
  );
  const { content } = useSolidDressing(ROCKS_SPEC, {
    renderDistance,
    colliderDistance,
    build: (rocks, _bodies, bounds) =>
      traceSpan("rocks:chunk", () => {
        const group = new THREE.Group();
        group.add(buildRockMesh(rocks, bounds, assets.rock.material));
        return { group };
      }),
  });
  return content;
};
