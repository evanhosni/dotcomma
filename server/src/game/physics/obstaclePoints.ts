import { DRESSING_COLLIDER_SPECS } from "../../../../src/objects/dressing/catalog";
import { runDressingEnumerator } from "../../../../src/objects/dressing/enumerators";
import { DRESSING_CHUNK_SIZE, type DressingColliderBody, type DressingColliderPart } from "../../../../src/objects/dressing/types";

/**
 * Every collider-bearing dressing feature (objects/dressing/catalog.ts) as plain data: each spec's
 * enumerator run with its spec placement, each point through its spec's bodiesOf. Rapier-free, so
 * the generation worker can run it. Chunk size MUST stay DRESSING_CHUNK_SIZE: belt-freeway pole and
 * bridge coverage depend on the query center's wall set.
 */

export interface ObstaclePoint extends DressingColliderBody {
  parts: DressingColliderPart[];
}

export const dressingChunkBounds = (gx: number, gz: number) => ({
  minX: gx * DRESSING_CHUNK_SIZE,
  minZ: gz * DRESSING_CHUNK_SIZE,
  maxX: (gx + 1) * DRESSING_CHUNK_SIZE,
  maxZ: (gz + 1) * DRESSING_CHUNK_SIZE,
});

export const enumerateObstacles = (gx: number, gz: number): ObstaclePoint[] => {
  const bounds = dressingChunkBounds(gx, gz);
  const out: ObstaclePoint[] = [];
  for (const spec of DRESSING_COLLIDER_SPECS) {
    for (const point of runDressingEnumerator(spec.enumerator, bounds, spec.placement)) {
      for (const body of spec.bodiesOf(point)) out.push({ ...body, parts: body.parts ?? spec.colliderParts });
    }
  }
  return out;
};
