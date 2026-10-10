import { describeBuildingSprite } from "../actors/building/sprite";
import { spawnPointId, type SpawnPoint } from "../actors/spawning/types";
import { INSTANCE_DATA, INSTANCE_FLOATS, INSTANCE_RENDER_DISTANCE, INSTANCE_SIZE, SPRITE_DATA_FLOATS } from "./layout";
import type { SpriteChunkLook, SpriteDescriber, SpriteDescription, SpriteKindSource } from "./types";

/** Every member's describer by name (SpriteLook.describer). Three-free: the spawn worker runs them. */
export const SPRITE_DESCRIBERS = {
  building: describeBuildingSprite,
} satisfies Record<string, SpriteDescriber>;

export type SpriteDescriberName = keyof typeof SPRITE_DESCRIBERS;

/** One chunk's placed points → its sprites, grouped by look and packed INSTANCE_FLOATS per sprite, x/z
 *  relative to the chunk's min corner (float32-exact; the client adds the corner in float64). Only sprite
 *  kinds produce sprites; a point its describer declines produces none. */
export const describeChunkSprites = (
  points: readonly SpawnPoint[],
  kinds: ReadonlyMap<string, SpriteKindSource>,
  chunkMinX: number,
  chunkMinZ: number,
): SpriteChunkLook[] => {
  const byLook = new Map<SpriteKindSource["describer"], { point: SpawnPoint; kind: SpriteKindSource; sprite: SpriteDescription }[]>();
  for (const point of points) {
    const kind = kinds.get(point.descriptorId);
    if (!kind) continue;
    const sprite = SPRITE_DESCRIBERS[kind.describer](kind.attributes, point.x, point.z);
    if (!sprite) continue;
    let described = byLook.get(kind.describer);
    if (!described) byLook.set(kind.describer, (described = []));
    described.push({ point, kind, sprite });
  }

  return Array.from(byLook, ([describer, described]) => {
    const instances = new Float32Array(described.length * INSTANCE_FLOATS);
    const ids = described.map(({ point, kind, sprite }, i) => {
      const o = i * INSTANCE_FLOATS;
      instances[o] = point.x - chunkMinX;
      instances[o + 1] = point.height;
      instances[o + 2] = point.z - chunkMinZ;
      instances[o + INSTANCE_SIZE] = sprite.width;
      instances[o + INSTANCE_SIZE + 1] = sprite.height;
      instances[o + INSTANCE_RENDER_DISTANCE] = kind.renderDistance;
      const count = Math.min(sprite.data.length, SPRITE_DATA_FLOATS);
      for (let d = 0; d < count; d++) instances[o + INSTANCE_DATA + d] = sprite.data[d];
      return spawnPointId(point.x, point.z, point.descriptorId);
    });
    return { describer, ids, instances };
  });
};
