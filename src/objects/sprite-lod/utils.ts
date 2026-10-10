import { SPAWN_CHUNK_SIZE } from "../../utils/workers/constants";

/** Seconds; the sprite clock (arrival fades) on both the CPU and the GPU. */
export const spriteClock = (): number => performance.now() / 1000;

/** Distance from (x, z) to the nearest point of the spawn chunk whose min corner is given: the one rule
 *  for what a chunk's area reaches, on the client and in the generator threads. */
export const chunkGap = (x: number, z: number, chunkMinX: number, chunkMinZ: number): number => {
  const half = SPAWN_CHUNK_SIZE / 2;
  const dx = Math.max(0, Math.abs(x - chunkMinX - half) - half);
  const dz = Math.max(0, Math.abs(z - chunkMinZ - half) - half);
  return Math.sqrt(dx * dx + dz * dz);
};
