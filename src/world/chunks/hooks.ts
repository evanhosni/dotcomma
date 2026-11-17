import { useFrame, useThree } from "@react-three/fiber";
import { useRef, useState, useEffect, useMemo } from "react";
import { reportContentError } from "../../utils/utils";
import type { ColliderBody, LiveColliderBody, ChunkBounds } from "./types";
import { CHUNK_COLLIDER_DISTANCE, WORLD_CHUNK_SIZE, CHUNK_QUEUE_WEIGHT, CHUNK_REQUESTS_IN_FLIGHT, UPDATE_INTERVAL_FRAMES, DROP_HYSTERESIS } from "./constants";
import * as THREE from "three";
import { BACKGROUND_RANK } from "../../utils/task-queue/constants";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { freezeStaticSubtree } from "../../utils/render/utils";
import { instancedTemplate, reportUnwarmedPrograms, warmPrograms } from "../../utils/render";
import { _spawnFade } from "../../vfx/spawn-fade";
import { prepareChunkMaterial } from "./material";
import { disposeChunkObject } from "./geometry";

/**
 * A STREAMED CHUNK'S REAL COLLIDERS: the bodies of the chunks near the player, scanned from the
 * chunk registry and built as imperative Rapier bodies (the dressing's useSolidDressing and the
 * tunnels both wire them this way).
 */

/** Whether two bodies listed under one key are the same body (a point two chunks both list). */
const sameBody = (a: ColliderBody, b: ColliderBody): boolean =>
  a.y === b.y && a.yaw === b.yaw && (a.pitch ?? 0) === (b.pitch ?? 0) && (a.parts?.length ?? -1) === (b.parts?.length ?? -1) && (a.mesh?.indices.length ?? -1) === (b.mesh?.indices.length ?? -1);

/** Real colliders only within `colliderDistance` (thousands of Rapier shapes would cost more than the
 *  instancing saved). The registry sweep must run every interval even when the scan is skipped:
 *  forEachAlive is what prunes unmounted chunks and fires their onRemove. */
export const useChunkColliders = <T extends { points: ColliderBody[] }>(
  registry: { forEachAlive: (cb: (entry: T) => void) => void },
  options: { colliderDistance?: number; scanIntervalFrames?: number } = {},
): LiveColliderBody[] => {
  const { colliderDistance = CHUNK_COLLIDER_DISTANCE, scanIntervalFrames = 10 } = options;
  const [colliders, setColliders] = useState<LiveColliderBody[]>([]);
  const frameCount = useRef(0);
  const aliveScratch = useRef<T[]>([]);
  const keyScratch = useRef(new Map<string, ColliderBody>());
  const lastScan = useRef({
    x: Infinity,
    z: Infinity,
    chunkCount: -1,
    pointCount: -1,
    colliderCount: -1,
    colliderHash: 0,
  });

  useFrame(({ camera }) => {
    if (frameCount.current++ % scanIntervalFrames !== 0) return;

    const alive = aliveScratch.current;
    alive.length = 0;
    let pointCount = 0;
    registry.forEachAlive((chunk) => {
      alive.push(chunk);
      pointCount += chunk.points.length;
    });

    const last = lastScan.current;
    const movedSq = (camera.position.x - last.x) ** 2 + (camera.position.z - last.z) ** 2;
    if (movedSq < 4 && alive.length === last.chunkCount && pointCount === last.pointCount) {
      alive.length = 0;
      return;
    }
    last.x = camera.position.x;
    last.z = camera.position.z;
    last.chunkCount = alive.length;
    last.pointCount = pointCount;

    const near: LiveColliderBody[] = [];
    const byKey = keyScratch.current;
    byKey.clear();
    let hash = 0;
    const maxDistSq = colliderDistance * colliderDistance;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          const key = p.key ?? `${p.x}_${p.z}`;
          // One body per key, and the bodies a key drops must be the SAME body (a point two chunks list):
          // a different one there would never be built — a missing collider, a fall through the world.
          const same = byKey.get(key);
          if (same) {
            if (!sameBody(same, p)) reportContentError(`[chunk colliders] two different bodies share the key "${key}": one would never be built. Give the feature's bodies unique \`key\`s (types.ts ColliderBody).`);
            continue;
          }
          byKey.set(key, p);
          near.push({ key, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, parts: p.parts, mesh: p.mesh });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
    byKey.clear();
    alive.length = 0;
    // Positions are deterministic, so equal count + hash = the same set.
    if (near.length !== last.colliderCount || hash !== last.colliderHash) {
      last.colliderCount = near.length;
      last.colliderHash = hash;
      setColliders(near);
    }
  });

  return colliders;
};

/**
 * THE WORLD'S STREAMING CHUNKS: a camera-following window of fixed 256u cells that build and
 * dispose what stands in them, on ONE budgeted queue. Everything streamed by POSITION rather than
 * by terrain LOD is built on this — the dressing, the tunnels — so none of them can miss a
 * world-wide effect (curvature, the spawn fade, program warm-up, the per-chunk fade).
 *
 * A system uses `useChunkAssets` (its shared geometries and materials) + `useWorldChunks` (the
 * lifecycle), `useChunkRegistry` for per-chunk side state, and `useChunkColliders` (world/chunks/hooks.ts)
 * where its chunks are solid. Terrain is NOT on this: its chunks are sized per LOD level and
 * driven by the quadtree (world/terrain/).
 */

const chunkQueue = new TaskQueue({ weight: CHUNK_QUEUE_WEIGHT, concurrency: CHUNK_REQUESTS_IN_FLIGHT });
/** A chunk is foreground work (ranked under BACKGROUND_RANK) from the moment it enters its feature's render
 *  distance, or from this close — whichever is farther. Ranked by plain distance, a far-reaching feature's
 *  chunks (the bridges' 900u, the waterfalls' 1000u, the rocks' 1400u) sat in the background until 400u,
 *  behind every near chunk and building: at 300u/s a bridge deck took ~2 s from range to built over the
 *  mountains (PERFORMANCE.md "Outrunning the generators again"). */
const FOREGROUND_REACH = BACKGROUND_RANK / CHUNK_QUEUE_WEIGHT;
const chunkRankWeight = (renderDistance: number): number => Math.min(1, FOREGROUND_REACH / renderDistance);

const isMaterial = (asset: unknown): asset is THREE.Material => !!(asset as THREE.Material | undefined)?.isMaterial;

/** `warm`: the objects this feature draws, as program templates (utils/render/index.ts) — linked at
 *  domain load, not when the first chunk streams in. Default: one InstancedMesh per material (what
 *  instancedFromPoints draws); a feature drawing anything else (a plain Mesh, instanceColor) lists its own. */
export const useChunkAssets = <T extends Record<string, { dispose: () => void }>>(
  create: () => T,
  warm?: (assets: T) => THREE.Object3D[]
): T => {
  const scene = useThree((state) => state.scene);
  const assets = useMemo(() => {
    const created = create();
    for (const asset of Object.values(created)) if (isMaterial(asset)) prepareChunkMaterial(asset);
    return created;
  }, []);
  useEffect(() => {
    const templates = warm ? warm(assets) : Object.values(assets).filter(isMaterial).map((m) => instancedTemplate(m));
    const cancelWarm = warmPrograms(scene, templates);
    return () => {
      cancelWarm();
      for (const key of Object.keys(assets)) assets[key].dispose();
    };
  }, [assets, scene]);
  return assets;
};

interface ChunkRegistryEntry {
  /** parent === null once the chunk lifecycle unmounts it — the prune signal. */
  group: THREE.Object3D;
}

/** Per-chunk side-state pruned lazily from the system's own frame loop (forEachAlive) and
 *  flushed on unmount — without the unmount flush, external registrations (lamp heads in
 *  the glow grid) leaked as phantom lights across domain switches / HMR. */
export const useChunkRegistry = <T extends ChunkRegistryEntry>(onRemove?: (entry: T) => void) => {
  const onRemoveRef = useRef(onRemove);
  onRemoveRef.current = onRemove;
  const registryRef = useRef<{
    entries: Set<T>;
    add: (entry: T) => void;
    forEachAlive: (cb: (entry: T) => void) => void;
  } | null>(null);
  if (!registryRef.current) {
    const entries = new Set<T>();
    registryRef.current = {
      entries,
      add: (entry) => {
        entries.add(entry);
      },
      forEachAlive: (cb) => {
        entries.forEach((entry) => {
          if (!entry.group.parent) {
            onRemoveRef.current?.(entry);
            entries.delete(entry);
            return;
          }
          cb(entry);
        });
      },
    };
  }
  useEffect(() => {
    const registry = registryRef.current!;
    return () => {
      registry.entries.forEach((entry) => onRemoveRef.current?.(entry));
      registry.entries.clear();
    };
  }, []);
  return registryRef.current;
};

/** `points` are the chunk's collider bodies — what the server builds the same bodies from. */
export interface ChunkWithPoints extends ChunkRegistryEntry {
  points: ColliderBody[];
}

interface StreamedChunk {
  object: THREE.Object3D | null;
  dropped: boolean;
  taskId: string | null;
  centerX: number;
  centerZ: number;
}

const chunkKeyOf = (cx: number, cz: number): string => `${cx}_${cz}`;

const chunkBoundsOf = (cx: number, cz: number): ChunkBounds => ({
  minX: cx * WORLD_CHUNK_SIZE,
  minZ: cz * WORLD_CHUNK_SIZE,
  maxX: (cx + 1) * WORLD_CHUNK_SIZE,
  maxZ: (cz + 1) * WORLD_CHUNK_SIZE,
});

/** Cancels a chunk's queued build and unmounts and disposes what it drew. */
const discardChunk = (chunk: StreamedChunk, group: THREE.Group | null, fades: _spawnFade.SpawnFadeSet): void => {
  chunk.dropped = true;
  if (chunk.taskId !== null) chunkQueue.removeTask(chunk.taskId);
  if (!chunk.object) return;
  group?.remove(chunk.object);
  fades.delete(chunk.object);
  disposeChunkObject(chunk.object);
};

interface ChunkCandidate {
  cx: number;
  cz: number;
  centerX: number;
  centerZ: number;
  distSq: number;
}

/** Camera-following chunk lifecycle; render the returned ref as `<group ref={groupRef} />`. */
export const useWorldChunks = ({
  renderDistance,
  build,
}: {
  renderDistance: number;
  /** null = empty chunk. Must be deterministic per bounds. */
  build: (bounds: ChunkBounds) => Promise<THREE.Object3D | null>;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const chunks = useRef(new Map<string, StreamedChunk>()).current;
  // Per CHUNK: a chunk's instances appear together, and the chunk is the unit that pops.
  const fades = useRef(new _spawnFade.SpawnFadeSet()).current;
  // Random phase so the streamed systems don't all scan on the same frame.
  const frameCount = useRef(Math.floor(Math.random() * UPDATE_INTERVAL_FRAMES));
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const group = groupRef.current;
    if (group) freezeStaticSubtree(group);
    return () => {
      chunks.forEach((chunk) => discardChunk(chunk, group, fades));
      chunks.clear();
      fades.clear();
    };
  }, [chunks, fades]);

  /** The chunks within the render distance not held yet, nearest-first: the shared queue serializes
   *  all features, and raw scan order built a fresh ring's far corner before the ground under the camera. */
  const missingChunks = (camX: number, camZ: number): ChunkCandidate[] => {
    const radius = Math.ceil(renderDistance / WORLD_CHUNK_SIZE);
    const ccx = Math.floor(camX / WORLD_CHUNK_SIZE);
    const ccz = Math.floor(camZ / WORLD_CHUNK_SIZE);
    const candidates: ChunkCandidate[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const centerX = (cx + 0.5) * WORLD_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * WORLD_CHUNK_SIZE;
        const distSq = (camX - centerX) ** 2 + (camZ - centerZ) ** 2;
        if (distSq > renderDistance * renderDistance) continue;
        if (chunks.has(chunkKeyOf(cx, cz))) continue;
        candidates.push({ cx, cz, centerX, centerZ, distSq });
      }
    }
    return candidates.sort((a, b) => a.distSq - b.distSq);
  };

  const queueChunk = ({ cx, cz, centerX, centerZ }: ChunkCandidate): void => {
    const entry: StreamedChunk = { object: null, dropped: false, taskId: null, centerX, centerZ };
    chunks.set(chunkKeyOf(cx, cz), entry);
    entry.taskId = chunkQueue.addTask(async () => {
      entry.taskId = null;
      if (entry.dropped) return;
      const object = await buildRef.current(chunkBoundsOf(cx, cz));
      if (!object) return;
      if (entry.dropped || !groupRef.current) {
        disposeChunkObject(object);
        return;
      }
      reportUnwarmedPrograms(object, "a dressing chunk", "list it in the feature's useChunkAssets(create, warm) templates.");
      freezeStaticSubtree(object);
      groupRef.current.add(object);
      fades.add(object);
      entry.object = object;
    }, { at: { x: centerX, z: centerZ }, weight: chunkRankWeight(renderDistance) });
  };

  const dropFarChunks = (group: THREE.Group, camX: number, camZ: number): void => {
    const dropDistance = renderDistance * DROP_HYSTERESIS;
    const dropDistSq = dropDistance * dropDistance;
    chunks.forEach((entry, key) => {
      const dx = camX - entry.centerX;
      const dz = camZ - entry.centerZ;
      if (dx * dx + dz * dz <= dropDistSq) return;
      discardChunk(entry, group, fades);
      chunks.delete(key);
    });
  };

  useFrame(({ camera }) => {
    fades.update();
    if (frameCount.current++ % UPDATE_INTERVAL_FRAMES !== 0) return;
    const group = groupRef.current;
    if (!group) return;
    for (const candidate of missingChunks(camera.position.x, camera.position.z)) queueChunk(candidate);
    dropFarChunks(group, camera.position.x, camera.position.z);
  });

  return groupRef;
};
