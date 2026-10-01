import { LOD5_CHUNK_SIZE } from "./lodConfig";
import type { SwapChunk } from "./lodSwaps";

const overlaps = (a: SwapChunk, b: SwapChunk): boolean => {
  const aHalf = a.lod.chunkSize / 2;
  const bHalf = b.lod.chunkSize / 2;
  return (
    a.offset.x + aHalf > b.offset.x - bHalf &&
    a.offset.x - aHalf < b.offset.x + bHalf &&
    a.offset.z + aHalf > b.offset.z - bHalf &&
    a.offset.z - aHalf < b.offset.z + bHalf
  );
};

// Tile = the largest chunk size, so any chunk spans at most 2×2 tiles. Scanning the whole set per
// overlap query was O(chunks × queue), which grows into the hundreds on both sides when the player
// outruns generation.
const INDEX_TILE = LOD5_CHUNK_SIZE;

/** Coarse spatial index over chunks. A chunk may sit in several buckets: forEachOverlap can repeat one. */
export class ChunkIndex<C extends SwapChunk> {
  private tiles = new Map<number, Map<number, C[]>>();
  private count = 0;

  clear(): void {
    if (this.count === 0) return;
    this.tiles.clear();
    this.count = 0;
  }

  add(chunk: C): void {
    this.visitTiles(chunk, (col, tz) => {
      const bucket = col.get(tz);
      if (bucket) bucket.push(chunk);
      else col.set(tz, [chunk]);
    }, true);
    this.count++;
  }

  overlapsAny(chunk: SwapChunk): boolean {
    if (this.count === 0) return false;
    let hit = false;
    this.forEachOverlap(chunk, () => {
      hit = true;
    });
    return hit;
  }

  forEachOverlap(chunk: SwapChunk, fn: (other: C) => void): void {
    if (this.count === 0) return;
    this.visitTiles(chunk, (col, tz) => {
      const bucket = col.get(tz);
      if (!bucket) return;
      for (let i = 0; i < bucket.length; i++) {
        const other = bucket[i];
        if (other !== chunk && overlaps(chunk, other)) fn(other);
      }
    }, false);
  }

  private visitTiles(chunk: SwapChunk, fn: (col: Map<number, C[]>, tz: number) => void, create: boolean): void {
    const half = chunk.lod.chunkSize / 2;
    const tx1 = Math.floor((chunk.offset.x + half) / INDEX_TILE);
    const tz0 = Math.floor((chunk.offset.z - half) / INDEX_TILE);
    const tz1 = Math.floor((chunk.offset.z + half) / INDEX_TILE);
    for (let tx = Math.floor((chunk.offset.x - half) / INDEX_TILE); tx <= tx1; tx++) {
      let col = this.tiles.get(tx);
      if (!col) {
        if (!create) continue;
        col = new Map();
        this.tiles.set(tx, col);
      }
      for (let tz = tz0; tz <= tz1; tz++) fn(col, tz);
    }
  }
}
