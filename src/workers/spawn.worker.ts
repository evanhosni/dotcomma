/**
 * Spawn point generation worker.
 *
 * Runs the density-based deterministic spawn algorithm off the main thread.
 * Maintains its own spatial hash and chunk cache. Uses the inlined vertex
 * pipeline to resolve biome/height data for each candidate point.
 *
 * Messages:
 *   IN:  { type: "INIT", config: WorldConfig, maxFootprint: number }
 *   IN:  { type: "GENERATE_SPAWNS", id: number, chunkKeys: string[], descriptors: SerializedDescriptor[] }
 *   IN:  { type: "CLEANUP", playerX: number, playerZ: number, cleanupRadius: number }
 *   IN:  { type: "UPDATE_FOOTPRINT", maxFootprint: number }
 *   OUT: { type: "INIT_DONE" }
 *   OUT: { type: "SPAWNS_RESULT", id: number, points: SpawnPoint[] }
 */

import { FlattenPoint, WorldConfig, initCompute, computeVertexData, getFlattenPoints, seedRand } from "./vertexCompute";

const SPAWN_CHUNK_SIZE = 250;

// ── Inline types (avoid importing from types.ts which depends on React) ──

interface SpawnPoint {
  x: number;
  z: number;
  height: number;
  biomeId: number;
  descriptorId: string;
}

interface SerializedDescriptor {
  id: string;
  footprint: number;
  density: number;
  clustering: number;
  renderDistance: number;
  priority?: number;
  biomeIds?: number[];
  heightRange?: [number, number];
  slopeRange?: [number, number];
  roadDistanceRange?: [number, number];
  spacingOverrides?: Record<string, number>;
  flattenGround?: boolean;
}

// ── Inline Spatial Hash ──

class SpatialHash {
  private cellSize: number;
  private invCellSize: number;
  // Nested numeric maps (cx → cz → bucket), the codebase-preferred pattern
  // (see ChunkIndex in TerrainRenderer.tsx). The old `${cx}_${cz}` string key
  // was built per candidate × 9 neighbor cells (~2,100 strings per
  // descriptor-chunk); numeric lookups allocate nothing. Query/insert
  // semantics and ordering are unchanged: buckets keep insertion order and
  // isTooClose scans the same dx-then-dz cell order as before.
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

// ── Worker State ──

let initialized = false;
let spatialHash: SpatialHash | null = null;

/** Cached chunk. Carries its own world-space CENTER and its spatial-hash
 *  membership: CLEANUP walks the whole cache on every spawn batch, and
 *  re-deriving coordinates by parsing the key string made eviction — the one
 *  thing keeping this cache bounded — the most expensive thing about it. */
interface CachedChunk {
  centerX: number;
  centerZ: number;
  points: SpawnPoint[];
  inHash: boolean;
}

const chunkCache = new Map<string, CachedChunk>();

// ── Spawn Generation ──

const generateForChunk = (
  chunkKey: string,
  sorted: SerializedDescriptor[] // pre-sorted by priority (once per message)
): SpawnPoint[] => {
  const hit = chunkCache.get(chunkKey);
  if (hit) {
    // Re-insert into spatial hash only if not already populated
    if (!hit.inHash) {
      for (const p of hit.points) spatialHash!.insert(p);
      hit.inHash = true;
    }
    return hit.points;
  }

  const sep = chunkKey.indexOf("_");
  const cx = Number(chunkKey.slice(0, sep));
  const cz = Number(chunkKey.slice(sep + 1));
  const chunkMinX = cx * SPAWN_CHUNK_SIZE;
  const chunkMinZ = cz * SPAWN_CHUNK_SIZE;

  const chunkPoints: SpawnPoint[] = [];

  // getFlattenPoints re-scans the chunk's tile window and returns ALL flatten
  // descriptors' points every call, so it's fetched ONCE per chunk (lazily, on
  // the first flattenGround descriptor) and bucketed by descId. Each bucket is
  // the exact subsequence the old per-descriptor `p.descId !== desc.id` filter
  // saw, in the same enumeration order, and buckets are still consumed in the
  // priority loop's order — so chunkPoints order and spatial-hash insertion
  // order are byte-identical to calling the engine per descriptor.
  let flattenByDesc: Map<string, FlattenPoint[]> | null = null;

  for (const desc of sorted) {
    // flattenGround actors: placement comes from the DETERMINISTIC flatten
    // engine (workers/vertexCompute.ts) — the same function the terrain uses
    // to put a flat pad under every instance, so points and pads can never
    // disagree. Points still enter the spatial hash so OTHER descriptors
    // space against them; their own spacing was already resolved by the
    // engine's stateless greedy.
    if (desc.flattenGround) {
      if (flattenByDesc === null) {
        flattenByDesc = new Map();
        for (const p of getFlattenPoints(
          chunkMinX,
          chunkMinZ,
          chunkMinX + SPAWN_CHUNK_SIZE,
          chunkMinZ + SPAWN_CHUNK_SIZE
        )) {
          let arr = flattenByDesc.get(p.descId);
          if (!arr) {
            arr = [];
            flattenByDesc.set(p.descId, arr);
          }
          arr.push(p);
        }
      }
      const descPoints = flattenByDesc.get(desc.id);
      if (descPoints) {
        for (const p of descPoints) {
          const point: SpawnPoint = {
            x: p.x,
            z: p.z,
            height: p.y,
            biomeId: p.biomeId,
            descriptorId: desc.id,
          };
          spatialHash!.insert(point);
          chunkPoints.push(point);
        }
      }
      continue;
    }

    if (desc.density <= 0) continue;

    const cellSize = Math.sqrt(1_000_000 / desc.density);
    const startCellX = Math.floor(chunkMinX / cellSize);
    const endCellX = Math.floor((chunkMinX + SPAWN_CHUNK_SIZE) / cellSize);
    const startCellZ = Math.floor(chunkMinZ / cellSize);
    const endCellZ = Math.floor((chunkMinZ + SPAWN_CHUNK_SIZE) / cellSize);

    for (let gx = startCellX; gx <= endCellX; gx++) {
      for (let gz = startCellZ; gz <= endCellZ; gz++) {
        const seed = `${desc.id}_${gx}_${gz}`;
        const rand = seedRand(seed);

        // Clustering gate
        if (desc.clustering > 0) {
          const clusterSeed = `cluster_${desc.id}_${gx}_${gz}`;
          const clusterRand = seedRand(clusterSeed);
          if (clusterRand < desc.clustering * 0.7) continue;
        }

        const jitterX = seedRand(seed + "_x");
        const jitterZ = seedRand(seed + "_z");

        const x = gx * cellSize + jitterX * cellSize;
        const z = gz * cellSize + jitterZ * cellSize;

        // Only place within this chunk
        if (
          x < chunkMinX ||
          x >= chunkMinX + SPAWN_CHUNK_SIZE ||
          z < chunkMinZ ||
          z >= chunkMinZ + SPAWN_CHUNK_SIZE
        ) {
          continue;
        }

        const probability = (desc.density * cellSize * cellSize) / 1_000_000;
        if (rand > probability) continue;

        // Get vertex data from inlined compute pipeline
        const vd = computeVertexData(x, z);

        // Biome restriction
        if (desc.biomeIds && desc.biomeIds.length > 0) {
          if (!desc.biomeIds.includes(vd.biomeId)) continue;
        }

        // Height restriction
        if (desc.heightRange) {
          if (vd.height < desc.heightRange[0] || vd.height > desc.heightRange[1])
            continue;
        }

        // Road distance restriction (distance to the road centerline —
        // in the city: keeps buildings inside blocks, lamps on sidewalks)
        if (desc.roadDistanceRange) {
          if (
            vd.distanceToRoadCenter < desc.roadDistanceRange[0] ||
            vd.distanceToRoadCenter > desc.roadDistanceRange[1]
          )
            continue;
        }

        // Spacing check via spatial hash
        if (
          spatialHash!.isTooClose(
            x,
            z,
            desc.footprint,
            desc.spacingOverrides
          )
        ) {
          continue;
        }

        const point: SpawnPoint = {
          x,
          z,
          height: vd.height,
          biomeId: vd.biomeId,
          descriptorId: desc.id,
        };

        spatialHash!.insert(point);
        chunkPoints.push(point);
      }
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

// ── Message Handler ──

self.onmessage = (e: MessageEvent) => {
  const { type } = e.data;

  if (type === "INIT") {
    initCompute(e.data.config as WorldConfig);
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

    // TIME-BUDGETED, not count-limited. Per-chunk cost varies by more than 10×
    // with terrain (a dense city chunk runs the flatten engine over thousands
    // of pad candidates; an empty grassland chunk is nearly free), so any fixed
    // chunk count is simultaneously too slow somewhere and too long somewhere
    // else. Keys arrive sorted nearest-first, so spending the budget in order
    // always buys the most useful chunks; whatever is left over is simply
    // re-requested next batch — re-sorted against the CURRENT camera position,
    // so ground the player has already left is dropped rather than generated.
    const { id, chunkKeys, descriptors, budgetMs } = e.data;
    const deadline = performance.now() + budgetMs;

    // Sort by priority once per message: lowest first (rarest objects placed
    // first). The descriptor set is fixed within a message, so sorting inside
    // generateForChunk just repeated the identical (stable) sort per chunk.
    const sorted = ([...descriptors] as SerializedDescriptor[]).sort(
      (a, b) => (a.priority ?? 50) - (b.priority ?? 50)
    );

    const allPoints: SpawnPoint[] = [];
    const done: string[] = [];

    for (const key of chunkKeys) {
      const points = generateForChunk(key, sorted);
      for (let i = 0; i < points.length; i++) allPoints.push(points[i]);
      done.push(key);
      // Checked AFTER the first chunk, so a single chunk costlier than the
      // whole budget still makes progress instead of deadlocking.
      if (performance.now() >= deadline) break;
    }

    (self as any).postMessage({ type: "SPAWNS_RESULT", id, points: allPoints, done });
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

      // Evict the chunk's points from the spatial hash too. Stale copies
      // would otherwise block their own deterministic regeneration when the
      // player returns (every candidate lands exactly on its old copy and
      // fails the spacing check), permanently despawning the chunk's objects.
      if (entry.inHash) {
        for (const p of entry.points) spatialHash!.remove(p);
        entry.inHash = false;
      }
      chunkCache.delete(key);
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
