import { useRapier } from "@react-three/rapier";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { useGameContext } from "../../context/GameContext";
import { traceEvent } from "../../utils/spikeTrace";
import { chargeFrameWork, isMachineStruggling } from "../../utils/task-queue/TaskQueue";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import type { PointXZ } from "../../utils/math/types";
import { LOD_FADE_UNIFORM } from "../shaders/lodFade";
import { createLodFadeMaterial, getMaterial } from "./material";
import { getWaterMaterial, tickWater } from "../water/waterMaterial";
import { meshTemplate, warmPrograms } from "../../utils/warmPrograms";
import { acquireGeometry, releaseGeometry, writeTerrainBuffers, writeWaterBuffers } from "./chunkGeometry";
import { LODLevel } from "./lodConfig";
import { computeDesiredChunks, DesiredChunks } from "./lodQuadtree";
import { FADE_OPAQUE_HI, LodSwapper, SwapHooks } from "./lodSwaps";
import { ensureTerrainWorker, requestChunkBuild, resetTerrainWorker } from "./terrainWorker";
import { Chunk, TerrainProps } from "./types";

const terrain: TerrainProps = {
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

/** A chunk's dither range into whichever material draws it (the fade variant, or the water): three
 *  uploads a shared material's uniforms only on a program switch or uniformsNeedUpdate, so each
 *  mesh writes its own range right before its draw. The opaque terrain material has no uLodFade. */
const syncLodFade =
  (chunk: Chunk) =>
  (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, _camera: THREE.Camera, _geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const uniform = (material as THREE.ShaderMaterial).uniforms?.[LOD_FADE_UNIFORM];
    if (!uniform) return;
    const range = uniform.value as THREE.Vector2;
    if (range.x === chunk.fadeLo && range.y === chunk.fadeHi) return;
    range.set(chunk.fadeLo, chunk.fadeHi);
    (material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
  };

/** A zero-area triangle: drawing it links a program and rasterizes nothing. */
const FADE_WARM_GEOMETRY = new THREE.BufferGeometry();
FADE_WARM_GEOMETRY.setAttribute("position", new THREE.BufferAttribute(new Float32Array(9), 3));

/** Drops a chunk's water surface back into the geometry pool (it shares the terrain's LOD family). */
const releaseWater = (chunk: Chunk) => {
  if (!chunk.water) return;
  chunk.plane.remove(chunk.water);
  releaseGeometry(chunk.lod, chunk.water.geometry);
  chunk.water = null;
};

/** The chunk's water mesh: a CHILD of its plane, so it shares the transform, visibility and LOD swaps. */
const ensureWaterMesh = (chunk: Chunk): THREE.Mesh => {
  if (chunk.water) return chunk.water;
  const water = new THREE.Mesh(acquireGeometry(chunk.lod), getWaterMaterial());
  water.castShadow = false;
  water.receiveShadow = false;
  water.renderOrder = 10;
  water.matrixAutoUpdate = false; // identity under its plane
  // Warmed with its plane like every streamed mesh: the first water in view otherwise compiled the
  // water program and uploaded its buffers at the frame the player turned to it.
  uploadOnFirstDraw(water);
  water.onBeforeRender = syncLodFade(chunk);
  chunk.plane.add(water);
  chunk.water = water;
  return water;
};

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

/** A new chunk's plane, hidden until its swap draws it and static once placed (buildChunk re-composes it). */
const createChunkPlane = (lod: LODLevel, material: THREE.Material): THREE.Mesh => {
  const plane = new THREE.Mesh(acquireGeometry(lod), material);
  plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
  plane.castShadow = false;
  // receiveShadow left on would recompile every terrain program the day a light casts a shadow.
  plane.receiveShadow = false;
  plane.rotation.x = -Math.PI / 2;
  plane.matrixAutoUpdate = false;
  plane.updateMatrix();
  uploadOnFirstDraw(plane);
  return plane;
};

const queueChunk = (chunkKey: string, offset: PointXZ, lod: LODLevel, material: THREE.Material): Chunk => {
  const plane = createChunkPlane(lod, material);
  const chunk: Chunk = {
    key: chunkKey,
    offset: { x: offset.x, z: offset.z },
    plane: plane,
    water: null,
    rebuildIterator: null,
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

export const TerrainRenderer = () => {
  const { camera, scene } = useThree();
  const { world, rapier } = useRapier();
  const [remainingChunks, setRemainingChunks] = useState<number | null>(null);
  const [totalChunks, setTotalChunks] = useState<number>(0);
  const [terrainMaterial, setTerrainMaterial] = useState<THREE.ShaderMaterial | null>(null);
  const { terrainLoaded, setProgress, setTerrainLoaded, playerSpawn } = useGameContext();
  const lastRemainingRef = React.useRef<number>(-1);
  const isUpdatingTerrain = React.useRef(false);
  /** The dithered variant drawn by chunks mid-fade (its own program: a `discard` would cost the
   *  opaque terrain its early depth test), and the mesh that links that program during the load. */
  const fadeMaterialRef = React.useRef<THREE.ShaderMaterial | null>(null);
  const fadeWarmRef = React.useRef<{ mesh: THREE.Mesh; drawn: boolean } | null>(null);

  // A new spawn (fast travel) restarts the loading gate: the stale remaining=0 would
  // otherwise flip terrainLoaded back on before the first pass around the new position.
  useEffect(() => {
    lastRemainingRef.current = -1;
    setRemainingChunks(null);
    terrainDirty = true;
  }, [playerSpawn?.[0], playerSpawn?.[1], playerSpawn?.[2]]);

  useEffect(() => {
    scene.add(terrain.group);
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

  useEffect(() => {
    if (!terrainLoaded) {
      if (remainingChunks !== null) {
        setProgress(1 - remainingChunks / totalChunks);
      }
      remainingChunks === 0 && setTerrainLoaded(true);
    }
  }, [remainingChunks, terrainLoaded]);

  useEffect(() => {
    getMaterial().then((material) => {
      const fade = createLodFadeMaterial(material);
      fadeMaterialRef.current = fade;
      // Links the fade program during the load, under the scene's real lights (they are part of the
      // program key): otherwise the first swap compiled the whole terrain shader mid-walk.
      const warm = new THREE.Mesh(FADE_WARM_GEOMETRY, fade);
      warm.frustumCulled = false;
      const state = { mesh: warm, drawn: false };
      warm.onAfterRender = () => {
        state.drawn = true;
      };
      terrain.group.add(warm);
      fadeWarmRef.current = state;
      setTerrainMaterial(material);
    });
  }, []);

  useFrame(({ clock }, delta) => {
    tickWater(clock.elapsedTime);
    const warm = fadeWarmRef.current;
    if (warm?.drawn) {
      terrain.group.remove(warm.mesh);
      fadeWarmRef.current = null;
    }
    // Every frame, even while an update pass is awaiting a build: a fade is timed in frames' delta.
    swapper.tick(delta, swapHooks);
    if (!terrainMaterial || isUpdatingTerrain.current) return;
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

    // Only the loading bar needs this; after terrainLoaded a re-render per queue change is waste.
    const newRemaining = terrain.queuedToBuild.length;
    if (newRemaining !== lastRemainingRef.current && !terrainLoaded) {
      lastRemainingRef.current = newRemaining;
      if (remainingChunks === null) setTotalChunks(newRemaining);
      setRemainingChunks(newRemaining);
    }

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
      chunk.rebuildIterator = buildChunk(chunk, material);
      try {
        await chunk.rebuildIterator.next();
        builtThisPass = true;
      } catch (error) {
        console.error("Error updating terrain:", error);
      }
      terrain.activeChunk = null;
      if (performance.now() > buildDeadline) break;
    }
    return builtThisPass;
  };

  const buildChunk = async function* (chunk: Chunk, material: THREE.Material) {
    await ensureTerrainWorker();
    const { offset, lod } = chunk;
    const result = await requestChunkBuild(lod, offset.x, offset.z);
    const traceT0 = performance.now();

    const geom = chunk.plane.geometry;
    writeTerrainBuffers(geom, lod, result);
    if (result.waterHeights) writeWaterBuffers(ensureWaterMesh(chunk).geometry, geom, lod, result.heights, result.waterHeights);
    else releaseWater(chunk);

    chunk.plane.material = material;
    chunk.plane.position.set(offset.x, 0, offset.z);
    chunk.plane.updateMatrix();

    if (lod.hasCollider && result.colliderHeights) {
      generateColliders(chunk, offset, result.colliderHeights);
    }

    const finishMs = performance.now() - traceT0;
    traceEvent(`terrain:finish L${lod.level}`, finishMs);
    chargeFrameWork(finishMs);
    chunk.built = true;

    yield;
  };

  /** Heightfield (column-major heights from the worker) straight into the
   *  Rapier world — never a React <RigidBody>, see CLAUDE.md. The desc is
   *  created before the body so a failure can't leave an empty body behind. */
  const generateColliders = (chunk: Chunk, offset: PointXZ, heights: Float32Array) => {
    const segments = chunk.lod.segments;
    const cs = chunk.lod.chunkSize;
    const t0 = performance.now();
    const desc = rapier.ColliderDesc.heightfield(segments, segments, heights, { x: cs, y: 1, z: cs });
    const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(offset.x, 0, offset.z));
    try {
      world.createCollider(desc, body);
    } catch (e) {
      world.removeRigidBody(body);
      console.error("terrain heightfield collider failed:", e);
      return;
    }
    chunk.colliderBody = body;
    traceEvent("terrain:collider", performance.now() - t0);
  };

  return null;
};
