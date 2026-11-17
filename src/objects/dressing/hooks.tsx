import { ChunkColliders } from "../../world/chunks/ChunkColliders";
import { useChunkColliders, useChunkRegistry, useWorldChunks } from "../../world/chunks/hooks";
import type { ChunkWithPoints } from "../../world/chunks/hooks";
import { enumerateDressing } from "./worker";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint, ChunkBounds, ColliderBody, DressingColliderSpec } from "./types";

/**
 * THE DRESSING BASE (CLAUDE.md → "The three game-object classes"): mass, identical, stateless
 * scenery as one InstancedMesh per chunk. A feature holds only its own placement query,
 * geometry/materials and optional animation; the INSTANCED assembly and the collider wiring are
 * here, and the chunk lifecycle itself is the world's (world/chunks/), shared with the tunnels.
 *
 * A feature uses: useChunkAssets (its geometry/materials) + useWorldChunks (a placement-only
 * feature) or useSolidDressing (a feature with a DressingColliderSpec), and instancedFromPoints
 * to assemble each chunk.
 */

// The chunk lifecycle, assets and registry are the WORLD's; re-exported so a feature has one import.
export { prepareChunkMaterial, selfPatchedMaterial } from "../../world/chunks/material";
export { useChunkAssets, useChunkRegistry, useWorldChunks } from "../../world/chunks/hooks";
export type { ChunkWithPoints } from "../../world/chunks/hooks";
export type { SelfPatchedMaterial } from "../../world/chunks/material";
export { yawFromDir } from "./types";

/**
 * A SOLID dressing feature — one with a DressingColliderSpec (listed in catalog.ts, so the server builds
 * the same colliders): the chunk lifecycle, the spec's enumerator run with the spec's placement, the
 * spec's bodies per chunk and the distance-gated colliders, wired once. The placement is the spec's
 * ONLY: the server never sees a mount, so a solid feature takes no placement props (change the spec).
 * `build` turns a chunk's points (and the bodies `spec.bodiesOf` places for them — the drawn yaw must
 * be the body's) into what the chunk draws plus any per-chunk side state, which `onRemove` releases
 * when the chunk unmounts. Render the returned `content`; drive per-chunk animation from
 * `registry.forEachAlive` in your own useFrame.
 */export const useSolidDressing = <K extends DressingEnumeratorName, T extends ChunkWithPoints = ChunkWithPoints>(
  spec: DressingColliderSpec<K>,
  options: {
    /** This client's request only, on top of the placement — must not move any point (e.g. power lines' `withNext`). */
    requestExtras?: Partial<EnumeratorArgs<K>>;
    /** Already resolved across the kind's mounts (objects/dressing/utils.ts `farthest`). */
    renderDistance: number;
    colliderDistance: number;
    onRemove?: (chunk: T) => void;
    build: (points: EnumeratorPoint<K>[], bodies: ColliderBody[], bounds: ChunkBounds) => Omit<T, "points">;
  },
) => {
  const { renderDistance, colliderDistance } = options;
  const registry = useChunkRegistry<T>(options.onRemove);
  const buildChunk = options.build;
  const request = options.requestExtras ? { ...spec.placement, ...options.requestExtras } : spec.placement;

  const groupRef = useWorldChunks({
    renderDistance,
    build: async (bounds) => {
      const points = await enumerateDressing(spec.enumerator, bounds, request);
      if (points.length === 0) return null;
      const bodies = points.flatMap(spec.bodiesOf);
      const chunk = buildChunk(points, bodies, bounds) as T;
      chunk.points = bodies;
      registry.add(chunk);
      return chunk.group;
    },
  });

  const colliders = useChunkColliders(registry, { colliderDistance });

  const content = (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the bodies near the player. */}
      <ChunkColliders colliders={colliders} parts={spec.colliderParts} />
    </>
  );
  return { registry, content };
};
