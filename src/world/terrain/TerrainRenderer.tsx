import { useRapier } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useDevContext } from "../../context/DevContext";
import { useGameContext } from "../../context/GameContext";
import type { PointXZ } from "../../utils/math/types";
import { traceEvent } from "../../utils/spikeTrace";
import { chargeFrameWork, isMachineStruggling } from "../../utils/task-queue/TaskQueue";
import { meshTemplate, warmPrograms } from "../../utils/warmPrograms";
import { skirtTintUniform } from "../shaders/skirtTint";
import { getWaterMaterial, tickWater } from "../water/waterMaterial";
import {
  adoptEarlyRequest,
  dropEarlyRequests,
  prefetchQueuedBuilds,
  prefetchTerrainAround,
  requestBuildOf,
  resetBuildRequests,
  setTerrainLoading,
} from "./buildRequests";
import { releaseGeometry, writeTerrainBuffers, writeWaterBuffers } from "./chunkGeometry";
import { createChunkPlane, ensureWaterMesh, generateColliders, releaseWater, syncLodFade } from "./chunkObjects";
import { LODLevel } from "./lodConfig";
import { computeDesiredChunks, DesiredChunks } from "./lodQuadtree";
import { FADE_OPAQUE_HI, LOD_FADE_SECONDS, LodSwapper, SwapHooks } from "./lodSwaps";
import { createLodFadeMaterial, getMaterial } from "./material";
import { ensureTerrainWorker, resetTerrainWorker } from "./terrainWorker";
import { Chunk, TerrainState } from "./types";

const terrain: TerrainState = {
  group: new THREE.Group(),
  chunks: new Map(),
  activeChunk: null,
  queuedToBuild: [],
};
// At the origin forever: a self-composing parent would force every chunk's matrixWorld each frame.
terrain.group.matrixAutoUpdate = false;

/** Chunk-set bookkeeping: stale chunks, the LOD cross-fades (lodSwaps.ts). */
const swapper = new LodSwapper<Chunk>();
// Dev inspection: the swap state, and `fadeSeconds` for A/B-ing the cross-fade.
if (process.env.NODE_ENV !== "production") (window as any).__terrainLod = { swapper, chunks: terrain.chunks };

// ── Steady-state gate ────────────────────────────────────────────────────────
// The desired set is recomputed only after DESIRED_MOVE_EPS of camera travel
// and the whole pass is skipped once queues are drained — the quadtree
// descent (~270 leaves, ~800 allocations) otherwise ran every parked frame.
const DESIRED_MOVE_EPS_SQ = 8 * 8;
let cachedDesired: DesiredChunks | null = null;
let desiredAtX = Infinity;
let desiredAtZ = Infinity;
let terrainDirty = true;

/** Wall-clock, not chunk-count: per-chunk cost varies >10× with LOD and terrain. At least one chunk
 *  builds per pass. */
const BUILD_BUDGET_MS = 5;

/** The build queue is re-sorted when it changed or after this much camera travel. */
const QUEUE_RESORT_MOVE_SQ = 64 * 64;
let queueDirty = false;
let lastSortX = Infinity;
let lastSortZ = Infinity;

// PRIORITY (the same notion as the TaskQueue's, utils/README.md): the build queue is sorted LOD1, then
// LOD2, each nearest-first, so the collider LODs under and around the player always build first. The
// visual-only far LODs yield while the machine is struggling: at most one per FAR_BUILD_INTERVAL_MS.
// Deferring one never opens a hole — an old chunk stays visible until its replacements are built —
// and the initial load is never throttled (the loading gate waits for every chunk).
const FAR_BUILD_INTERVAL_MS = 250;
let lastFarBuildAt = -Infinity;

/** Domain-switch teardown of the MODULE state that survives a remount. The
 *  geometry pool is kept: pooled geometries are fully rewritten on acquire. */
export const resetTerrainSystem = () => {
  resetTerrainWorker();
  for (const chunk of terrain.chunks.values()) {
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    releaseWater(chunk);
    terrain.group.remove(chunk.plane);
    // Bodies already left the persistent physics world in the unmount cleanup.
    chunk.colliderBody = null;
  }
  terrain.chunks.clear();
  terrain.activeChunk = null;
  terrain.queuedToBuild.length = 0;
  resetBuildRequests();
  swapper.reset();
  queueDirty = false;
  cachedDesired = null;
  desiredAtX = Infinity;
  desiredAtZ = Infinity;
  terrainDirty = true;
  lastSortX = Infinity;
  lastSortZ = Infinity;
};

/** Drops pruned chunks from the build queue in place, then re-sorts it (LOD1 first, then LOD2, …, each
 *  nearest-first; popped from the END) when it changed or the camera moved. */
const prepareBuildQueue = (playerX: number, playerZ: number): void => {
  const queue = terrain.queuedToBuild;
  let w = 0;
  for (let i = 0; i < queue.length; i++) {
    if (terrain.chunks.get(queue[i].key) === queue[i]) queue[w++] = queue[i];
  }
  if (w !== queue.length) {
    queue.length = w;
    queueDirty = true;
  }
  if (queue.length === 0) return;
  const sdx = playerX - lastSortX;
  const sdz = playerZ - lastSortZ;
  if (!queueDirty && sdx * sdx + sdz * sdz <= QUEUE_RESORT_MOVE_SQ) return;
  queueDirty = false;
  lastSortX = playerX;
  lastSortZ = playerZ;
  queue.sort((a, b) => {
    if (a.lod.level !== b.lod.level) return b.lod.level - a.lod.level;
    const distA = (a.offset.x - playerX) ** 2 + (a.offset.z - playerZ) ** 2;
    const distB = (b.offset.x - playerX) ** 2 + (b.offset.z - playerZ) ** 2;
    return distB - distA;
  });
};

/** A far visual-only chunk waits its turn while the machine struggles (never during the initial load). */
const isFarBuildDeferred = (lod: LODLevel, terrainLoaded: boolean): boolean => {
  if (!terrainLoaded || lod.hasCollider) return false;
  const t = performance.now();
  if (isMachineStruggling() && t - lastFarBuildAt < FAR_BUILD_INTERVAL_MS) return true;
  lastFarBuildAt = t;
  return false;
};

const queueChunk = (chunkKey: string, offset: PointXZ, lod: LODLevel, material: THREE.Material): Chunk => {
  const plane = createChunkPlane(lod, material);
  const chunk: Chunk = {
    key: chunkKey,
    offset: { x: offset.x, z: offset.z },
    plane: plane,
    water: null,
    request: adoptEarlyRequest(chunkKey),
    colliderBody: null,
    lod: lod,
    built: false,
    drawn: false,
    transition: null,
    fadeLo: 0,
    fadeHi: FADE_OPAQUE_HI,
  };
  plane.onBeforeRender = syncLodFade(chunk);

  terrain.group.add(plane);
  terrain.queuedToBuild.push(chunk);
  queueDirty = true;

  return chunk;
};

/** The loading bar and the terrain gate: progress follows the build queue until it first drains, which
 *  opens the gate. Returns the reporter the update pass calls with the queue's length. */
const useLoadingGate = (): ((remaining: number) => void) => {
  const { terrainLoaded, setProgress, setTerrainLoaded, playerSpawn } = useGameContext();
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const lastRemainingRef = React.useRef<number>(-1);

  // A new spawn (fast travel) restarts the loading gate: the stale remaining=0 would
  // otherwise flip terrainLoaded back on before the first pass around the new position.
  useEffect(() => {
    lastRemainingRef.current = -1;
    setRemainingChunks(null);
    terrainDirty = true;
  }, [playerSpawn?.[0], playerSpawn?.[1], playerSpawn?.[2]]);

  useEffect(() => {
    setTerrainLoading(!terrainLoaded);
    if (!terrainLoaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      if (remainingChunks === 0) {
        setTerrainLoaded(true);
        dropEarlyRequests();
      }
    }
  }, [remainingChunks, terrainLoaded]);

  // Only the loading bar needs this; after terrainLoaded a re-render per queue change is waste.
  return (remaining) => {
    if (remaining === lastRemainingRef.current || terrainLoaded) return;
    lastRemainingRef.current = remaining;
    if (remainingChunks === null) setTotalChunks(remaining);
    setRemainingChunks(remaining);
  };
};

export const TerrainRenderer = () => {
  const { camera, scene } = useThree();
  const { world, rapier } = useRapier();
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.ShaderMaterial | null>(null);
  const { terrainLoaded, playerSpawn } = useGameContext();
  const reportRemaining = useLoadingGate();
  const isUpdatingTerrain = React.useRef(false);
  /** The dithered variant drawn by chunks mid-fade (its own program: a `discard` would cost the
   *  opaque terrain its early depth test). */
  const fadeMaterialRef = React.useRef<THREE.ShaderMaterial | null>(null);

  // Devmode seam diagnostics (terrain/README.md).
  const { tintSkirts, noLodFade } = useDevContext();
  useEffect(() => {
    skirtTintUniform.value = tintSkirts ? 1 : 0;
  }, [tintSkirts]);
  useEffect(() => {
    swapper.fadeSeconds = noLodFade ? 0 : LOD_FADE_SECONDS;
  }, [noLodFade]);

  useEffect(() => {
    scene.add(terrain.group);
    // Booted at mount, not at the first build: that waited for the material, and the INIT reply then
    // queued behind the load's shader links.
    ensureTerrainWorker();
    // The first water in reach can build long after the load (utils/warmPrograms.ts).
    const cancelWaterWarm = warmPrograms(scene, [meshTemplate(getWaterMaterial())]);
    return () => {
      cancelWaterWarm();
      scene.remove(terrain.group);
      // The physics world outlives the domain, so heightfield bodies must leave with this mount.
      for (const chunk of terrain.chunks.values()) {
        if (chunk.colliderBody !== null) {
          world.removeRigidBody(chunk.colliderBody);
          chunk.colliderBody = null;
        }
      }
    };
  }, []);

  const destroyChunk = (chunk: Chunk) => {
    if (terrain.chunks.get(chunk.key) !== chunk) return;
    if (chunk.colliderBody !== null) {
      world.removeRigidBody(chunk.colliderBody); // removes its heightfield too
      chunk.colliderBody = null;
    }
    releaseGeometry(chunk.lod, chunk.plane.geometry);
    releaseWater(chunk);
    terrain.group.remove(chunk.plane);
    terrain.chunks.delete(chunk.key);
  };

  const swapHooks: SwapHooks<Chunk> = {
    isDesired: (key) => cachedDesired !== null && cachedDesired[key] !== undefined,
    destroy: destroyChunk,
    redraw: (chunk) => {
      chunk.plane.visible = chunk.drawn;
      const material = chunk.transition !== null ? fadeMaterialRef.current : terrainMaterial;
      if (material) chunk.plane.material = material;
    },
  };

  // Both terrain programs link during the load, together (utils/warmPrograms.ts), and the chunks wait
  // for them: the fade twin otherwise linked at the first swap, mid-walk, and the opaque one inside the
  // first chunk's draw — the load's two longest tasks (~1s each).
  useEffect(() => {
    let cancelWarm = () => {};
    let unmounted = false;
    getMaterial().then((material) => {
      if (unmounted) return;
      const fade = createLodFadeMaterial(material);
      fadeMaterialRef.current = fade;
      cancelWarm = warmPrograms(scene, [meshTemplate(material), meshTemplate(fade)], () => setTerrainMaterial(material));
    });
    return () => {
      unmounted = true;
      cancelWarm();
    };
  }, []);

  useFrame(({ clock }, delta) => {
    tickWater(clock.elapsedTime);
    // Every frame, even while an update pass is awaiting a build: a fade is timed in frames' delta.
    swapper.tick(delta, swapHooks);
    if (!terrainMaterial) {
      if (playerSpawn) prefetchTerrainAround(playerSpawn[0], playerSpawn[2]);
      return;
    }
    if (isUpdatingTerrain.current) return;
    // Synchronous early-out: reaching the same gate inside the async updateTerrain
    // cost a promise chain + microtask drain every parked frame.
    if (!terrainDirty && cachedDesired !== null) {
      const mdx = camera.position.x - desiredAtX;
      const mdz = camera.position.z - desiredAtZ;
      if (mdx * mdx + mdz * mdz <= DESIRED_MOVE_EPS_SQ) return;
    }
    isUpdatingTerrain.current = true;
    updateTerrain(terrainMaterial).finally(() => {
      isUpdatingTerrain.current = false;
    });
  });

  const updateTerrain = async (material: THREE.Material) => {
    const playerX = camera.position.x;
    const playerZ = camera.position.z;

    // ── 1. Recompute desired chunks only after real movement ─────────────
    const mdx = playerX - desiredAtX;
    const mdz = playerZ - desiredAtZ;
    const moved = cachedDesired === null || mdx * mdx + mdz * mdz > DESIRED_MOVE_EPS_SQ;
    if (!moved && !terrainDirty) return;
    if (moved) {
      cachedDesired = computeDesiredChunks(playerX, playerZ);
      desiredAtX = playerX;
      desiredAtZ = playerZ;
    }
    const desiredChunks = cachedDesired!;

    // ── 2. Drawn chunks no longer desired go stale; undrawn ones are dropped ──
    swapper.prune(terrain.chunks.values(), swapHooks.isDesired, terrain.activeChunk, destroyChunk);

    // ── 3. Add new desired chunks ────────────────────────────────────────
    for (const chunkKey in desiredChunks) {
      if (terrain.chunks.has(chunkKey)) continue;
      const { position, lod } = desiredChunks[chunkKey];
      terrain.chunks.set(chunkKey, queueChunk(chunkKey, { x: position[0], z: position[1] }, lod, material));
    }

    // ── 4. LOD swaps: start every cross-fade that is ready ───────────────
    swapper.processSwaps(terrain.chunks.values(), swapHooks);

    // ── 5. Build chunks until the time budget runs out ───────────────────
    const builtThisPass = await buildQueuedChunks(material, playerX, playerZ);

    reportRemaining(terrain.queuedToBuild.length);

    // Stay "dirty" while anything is still in flight, and for one extra pass
    // after the last build so processSwaps gets to draw it.
    terrainDirty =
      builtThisPass ||
      terrain.queuedToBuild.length > 0 ||
      terrain.activeChunk !== null ||
      swapper.stale.size > 0 ||
      swapper.busy;
  };

  /** Builds queued chunks until BUILD_BUDGET_MS has passed (at least one); true if any built. */
  const buildQueuedChunks = async (material: THREE.Material, playerX: number, playerZ: number): Promise<boolean> => {
    const buildDeadline = performance.now() + BUILD_BUDGET_MS;
    let builtThisPass = false;
    prepareBuildQueue(playerX, playerZ);
    while (terrain.queuedToBuild.length > 0) {
      const next = terrain.queuedToBuild[terrain.queuedToBuild.length - 1];
      if (isFarBuildDeferred(next.lod, terrainLoaded)) break;
      const chunk = terrain.queuedToBuild.pop()!;
      terrain.activeChunk = chunk;
      requestBuildOf(chunk);
      prefetchQueuedBuilds(terrain.queuedToBuild, terrainLoaded);
      try {
        await buildChunk(chunk, material);
        builtThisPass = true;
      } catch (error) {
        console.error("Error updating terrain:", error);
      }
      terrain.activeChunk = null;
      if (performance.now() > buildDeadline) break;
      // Prefetched results are often ready at once; a struggling machine still finishes one per frame,
      // as it did when every chunk waited for its own round trip.
      if (terrainLoaded && isMachineStruggling()) break;
    }
    return builtThisPass;
  };

  /** Awaits the chunk's worker build and writes it into its meshes and collider. */
  const buildChunk = async (chunk: Chunk, material: THREE.Material): Promise<void> => {
    await ensureTerrainWorker();
    const { offset, lod } = chunk;
    const result = await requestBuildOf(chunk);
    chunk.request = null;
    const traceT0 = performance.now();

    const geom = chunk.plane.geometry;
    writeTerrainBuffers(geom, lod, result);
    if (result.waterHeights) writeWaterBuffers(ensureWaterMesh(chunk).geometry, geom, lod, result.heights, result.waterHeights);
    else releaseWater(chunk);

    chunk.plane.material = material;
    chunk.plane.position.set(offset.x, 0, offset.z);
    chunk.plane.updateMatrix();

    if (lod.hasCollider && result.colliderHeights) {
      generateColliders(world, rapier, chunk, result.colliderHeights);
    }

    const finishMs = performance.now() - traceT0;
    traceEvent(`terrain:finish L${lod.level}`, finishMs);
    chargeFrameWork(finishMs);
    chunk.built = true;
  };

  return null;
};
