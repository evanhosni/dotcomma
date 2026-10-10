/**
 * Spawn point worker: deterministic density placement with its own spatial hash
 * and chunk cache.
 *
 *   IN:  { type: "INIT", config: DomainConfig, maxFootprint: number }
 *   IN:  { type: "GENERATE_SPAWNS", id: number, chunkKeys: string[], descriptors: SerializedDescriptor[] }
 *   IN:  { type: "CLEANUP", playerX: number, playerZ: number, cleanupRadius: number }
 *   IN:  { type: "UPDATE_FOOTPRINT", maxFootprint: number }
 *   IN:  { type: "GENERATE_SPRITES", id: number, chunkKeys: string[], descriptors: SerializedDescriptor[],
 *          kinds: SpriteKindSource[], budgetMs: number, forget: { x: number, z: number, distance: number } }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "SPAWNS_RESULT", id: number, points: SpawnPoint[] }
 *   OUT: { type: "SPRITES_RESULT", id: number, chunks: SpriteChunkResult[] }
 *
 * GENERATE_SPRITES runs on the sprite tier's own instances of this worker (sprite-lod/spriteWorker.ts): the
 * same placement, then each sprite kind's describer per point.
 */

import { FlattenPoint, DomainConfig, initCompute, computeVertexData, getFlattenPoints, outsideBiomes, riverKeepOff } from "./vertexCompute";
import { densityCellRange, densityCellSize, densityProbability, passesPlacementFilters, rollDensityCell } from "./densityGrid";
import { slopeDegreesAt } from "./densityPoints";
import { SPAWN_CHUNK_SIZE } from "./constants";
// Type-only: keeps the React-dependent module out of the worker bundle.
import type { SerializedActorDescriptor as SerializedDescriptor, SpawnPoint } from "../../objects/actors/spawning/types";
import { describeChunkSprites } from "../../objects/sprite-lod/describers";
import { chunkGap } from "../../objects/sprite-lod/utils";
import type { SpriteChunkResult, SpriteKindSource } from "../../objects/sprite-lod/types";

class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  // Nested numeric maps (cx → cz → bucket): no string key per candidate × 9 neighbor cells.
  // Buckets keep insertion order; isTooClose scans dx-then-dz.
  private cells = new Map<number, Map<number, SpawnPoint[]>>();

  constructor(maxFootprint: number) {
    this.cellSize = Math.max(maxFootprint * 2.5, 1);
    this.invCellSize = 1 / this.cellSize;
  }

  insert(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    let row = this.cells.get(cx);
    if (!row) {
      row = new Map();
      this.cells.set(cx, row);
    }
    let bucket = row.get(cz);
    if (!bucket) {
      bucket = [];
      row.set(cz, bucket);
    }
    bucket.push(point);
  }

  /** Remove by identity (points in the hash are the same refs held by chunkCache). */
  remove(point: SpawnPoint): void {
    const cx = Math.floor(point.x * this.invCellSize);
    const cz = Math.floor(point.z * this.invCellSize);
    const row = this.cells.get(cx);
    if (!row) return;
    const bucket = row.get(cz);
    if (!bucket) return;
    const i = bucket.indexOf(point);
    if (i !== -1) bucket.splice(i, 1);
    if (bucket.length === 0) {
      row.delete(cz);
      if (row.size === 0) this.cells.delete(cx);
    }
  }

  isTooClose(
    x: number,
    z: number,
    minDist: number,
    spacingOverrides?: Record<string, number>
  ): boolean {
    const minDistSq = minDist * minDist;
    const searchRadius = Math.max(
      minDist,
      spacingOverrides ? Math.max(...Object.values(spacingOverrides)) : 0
    );
    const cellSpan = Math.ceil(searchRadius * this.invCellSize);
    const cx = Math.floor(x * this.invCellSize);
    const cz = Math.floor(z * this.invCellSize);

    for (let dx = -cellSpan; dx <= cellSpan; dx++) {
      const row = this.cells.get(cx + dx);
      if (!row) continue;
      for (let dz = -cellSpan; dz <= cellSpan; dz++) {
        const bucket = row.get(cz + dz);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const p = bucket[i];
          const ddx = x - p.x;
          const ddz = z - p.z;
          const distSq = ddx * ddx + ddz * ddz;

          const overrideDist = spacingOverrides?.[p.descriptorId];
          if (overrideDist !== undefined) {
            if (distSq < overrideDist * overrideDist) return true;
          } else if (distSq < minDistSq) {
            return true;
          }
        }
      }
    }
    return false;
  }
}

let initialized = false;
let spatialHash: SpatialHash | null = null;

/** Carries its own center and hash membership: CLEANUP walks the whole cache
 *  every batch, and must not parse coordinates out of the key. */
interface CachedChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
  inHash: boolean;
}

const chunkCache = new Map<string, CachedChunk>();

/** Evicts from the hash too: stale copies block their own deterministic regeneration (every candidate
 *  lands on its old copy and fails spacing). */
const forgetChunk = (key: string, entry: CachedChunk): void => {
  if (entry.inHash) {
    for (const p of entry.points) spatialHash!.remove(p);
    entry.inHash = false;
  }
  chunkCache.delete(key);
};

/** Every flatten-pad point of a chunk (getFlattenPoints returns all descriptors' at once), bucketed
 *  by descriptor id in the engine's order. */
const flattenPointsByDescriptor = (chunkMinX: number, chunkMinZ: number): Map<string, FlattenPoint[]> => {
  const byDesc = new Map<string, FlattenPoint[]>();
  for (const p of getFlattenPoints(chunkMinX, chunkMinZ, chunkMinX + SPAWN_CHUNK_SIZE, chunkMinZ + SPAWN_CHUNK_SIZE)) {
    let arr = byDesc.get(p.descId);
    if (!arr) {
      arr = [];
      byDesc.set(p.descId, arr);
    }
    arr.push(p);
  }
  return byDesc;
};

/** A flattenGround descriptor's points come from the flatten engine (the same function the terrain
 *  pads under) and still enter the hash, so OTHER descriptors space against them. */
const placeFlattenPoints = (desc: SerializedDescriptor, descPoints: FlattenPoint[] | undefined, out: SpawnPoint[]): void => {
  if (!descPoints) return;
  for (const p of descPoints) {
    const point: SpawnPoint = {
      x: p.x,
      z: p.z,
      height: p.y,
      biomeId: p.biomeId,
      descriptorId: desc.id,
    };
    spatialHash!.insert(point);
    out.push(point);
  }
};

/** A density descriptor over one chunk: the shared density-grid roll, the placement filters, its
 *  slopeRange, then spacing against everything already in the hash. */
const placeDensityPoints = (desc: SerializedDescriptor, chunkMinX: number, chunkMinZ: number, out: SpawnPoint[]): void => {
  const cellSize = densityCellSize(desc.density);
  const [startCellX, endCellX] = densityCellRange(chunkMinX, chunkMinX + SPAWN_CHUNK_SIZE, cellSize);
  const [startCellZ, endCellZ] = densityCellRange(chunkMinZ, chunkMinZ + SPAWN_CHUNK_SIZE, cellSize);
  const probability = densityProbability(desc.density, cellSize);

  for (let gx = startCellX; gx <= endCellX; gx++) {
    for (let gz = startCellZ; gz <= endCellZ; gz++) {
      const roll = rollDensityCell(desc.id, gx, gz, cellSize, probability, desc.clustering);
      if (!roll) continue;
      const { x, z } = roll;
      if (x < chunkMinX || x >= chunkMinX + SPAWN_CHUNK_SIZE || z < chunkMinZ || z >= chunkMinZ + SPAWN_CHUNK_SIZE) continue;
      if (outsideBiomes(desc.biomeIds, x, z)) continue;

      const vd = computeVertexData(x, z);
      if (!passesPlacementFilters(vd, desc, riverKeepOff())) continue;
      if (desc.slopeRange) {
        const slope = slopeDegreesAt(x, z);
        if (slope < desc.slopeRange[0] || slope > desc.slopeRange[1]) continue;
      }
      if (spatialHash!.isTooClose(x, z, desc.footprint, desc.spacingOverrides)) continue;

      const point: SpawnPoint = {
        x,
        z,
        height: vd.height,
        biomeId: vd.biomeId,
        descriptorId: desc.id,
      };
      spatialHash!.insert(point);
      out.push(point);
    }
  }
};

/** A chunk key, `${cx}_${cz}`, to its min corner. */
const chunkMinOf = (chunkKey: string): [number, number] => {
  const sep = chunkKey.indexOf("_");
  return [Number(chunkKey.slice(0, sep)) * SPAWN_CHUNK_SIZE, Number(chunkKey.slice(sep + 1)) * SPAWN_CHUNK_SIZE];
};

const generateForChunk = (
  chunkKey: string,
  descriptorsByPriority: SerializedDescriptor[] // pre-sorted by priority (once per message)
): SpawnPoint[] => {
  const cached = chunkCache.get(chunkKey);
  if (cached) {
    if (!cached.inHash) {
      for (const p of cached.points) spatialHash!.insert(p);
      cached.inHash = true;
    }
    return cached.points;
  }

  const [chunkMinX, chunkMinZ] = chunkMinOf(chunkKey);

  const chunkPoints: SpawnPoint[] = [];
  // Fetched once per chunk, on the first flatten descriptor; consumption in priority order keeps
  // the hash's insertion order identical to asking the engine per descriptor.
  let flattenByDesc: Map<string, FlattenPoint[]> | null = null;
  for (const desc of descriptorsByPriority) {
    if (desc.flattenGround) {
      if (flattenByDesc === null) flattenByDesc = flattenPointsByDescriptor(chunkMinX, chunkMinZ);
      placeFlattenPoints(desc, flattenByDesc.get(desc.id), chunkPoints);
    } else if (desc.density > 0) {
      placeDensityPoints(desc, chunkMinX, chunkMinZ, chunkPoints);
    }
  }

  chunkCache.set(chunkKey, {
    centerX: chunkMinX + SPAWN_CHUNK_SIZE / 2,
    centerZ: chunkMinZ + SPAWN_CHUNK_SIZE / 2,
    points: chunkPoints,
    inHash: true,
  });
  return chunkPoints;
};

/** One chunk's sprites. A throw (placement or a describer) is logged and answered as a failed chunk: the
 *  client retries it, then loads it empty, so it never stalls. */
const describeSpriteChunk = (
  key: string,
  descriptorsByPriority: SerializedDescriptor[],
  kinds: ReadonlyMap<string, SpriteKindSource>,
  transfer: Transferable[],
): SpriteChunkResult => {
  try {
    const [chunkMinX, chunkMinZ] = chunkMinOf(key);
    const looks = describeChunkSprites(generateForChunk(key, descriptorsByPriority), kinds, chunkMinX, chunkMinZ);
    for (const look of looks) transfer.push(look.instances.buffer);
    return { key, failed: false, looks };
  } catch (error) {
    console.error(`[sprite-lod] generating chunk ${key} failed:`, error);
    return { key, failed: true, looks: [] };
  }
};

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as DomainConfig);
    spatialHash = new SpatialHash(e.data.maxFootprint);
    initialized = true;
    (self as any).postMessage({ type: "INIT_DONE" });
    return;
  }

  if (type === "GENERATE_SPAWNS") {
    if (!initialized) {
      (self as any).postMessage({ type: "SPAWNS_RESULT", id: e.data.id, points: [], done: [] });
      return;
    }

    // TIME-budgeted: per-chunk cost varies >10× with terrain, so any fixed count is
    // wrong somewhere. Keys arrive nearest-first; leftovers are re-requested next
    // batch against the CURRENT camera position.
    const { id, chunkKeys, descriptors, budgetMs } = e.data;
    const deadline = performance.now() + budgetMs;

    // Lowest priority first (rarest placed first).
    const descriptorsByPriority = ([...descriptors] as SerializedDescriptor[]).sort(
      (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
    );

    const allPoints: SpawnPoint[] = [];
    const done: string[] = [];

    for (const key of chunkKeys) {
      const points = generateForChunk(key, descriptorsByPriority);
      for (let i = 0; i < points.length; i++) allPoints.push(points[i]);
      done.push(key);
      // Checked AFTER the first chunk so one over-budget chunk still makes progress.
      if (performance.now() >= deadline) break;
    }

    (self as any).postMessage({ type: "SPAWNS_RESULT", id, points: allPoints, done });
    return;
  }

  if (type === "GENERATE_SPRITES") {
    const { id, chunkKeys, descriptors, kinds, budgetMs, forget } = e.data;
    if (!initialized) {
      (self as any).postMessage({ type: "SPRITES_RESULT", id, chunks: [] });
      return;
    }
    // The client's rule: a chunk is forgotten once its nearest edge is past the drop distance.
    chunkCache.forEach((entry, key) => {
      const minX = entry.centerX - SPAWN_CHUNK_SIZE / 2;
      const minZ = entry.centerZ - SPAWN_CHUNK_SIZE / 2;
      if (chunkGap(forget.x, forget.z, minX, minZ) > forget.distance) forgetChunk(key, entry);
    });

    const deadline = performance.now() + budgetMs;
    const descriptorsByPriority = ([...descriptors] as SerializedDescriptor[]).sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));
    const kindsById = new Map((kinds as SpriteKindSource[]).map((kind) => [kind.id, kind]));
    const chunks: SpriteChunkResult[] = [];
    const transfer: Transferable[] = [];
    for (const key of chunkKeys as string[]) {
      chunks.push(describeSpriteChunk(key, descriptorsByPriority, kindsById, transfer));
      // After the first chunk, so an over-budget chunk still makes progress.
      if (performance.now() >= deadline) break;
    }
    (self as any).postMessage({ type: "SPRITES_RESULT", id, chunks }, transfer);
    return;
  }

  if (type === "CLEANUP") {
    const { playerX, playerZ, cleanupRadius } = e.data;
    const cleanupRadiusSq = cleanupRadius * cleanupRadius;

    // Coordinates live on the entry — no key parsing, just a distance test.
    chunkCache.forEach((entry, key) => {
      const dx = playerX - entry.centerX;
      const dz = playerZ - entry.centerZ;
      if (dx * dx + dz * dz <= cleanupRadiusSq) return;
      forgetChunk(key, entry);
    });
    return;
  }

  if (type === "UPDATE_FOOTPRINT") {
    spatialHash = new SpatialHash(e.data.maxFootprint);
    chunkCache.forEach((entry) => {
      entry.inHash = false;
    });
    return;
  }
};
