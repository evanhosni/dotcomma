import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useGameContext } from "../../context/GameContext";
import { getActiveRegions, getActiveWorldConfig } from "../../world/registry";
import { collectDescriptors } from "./collectDescriptors";
import {
  cleanupSpawnCache,
  generateSpawnPoints,
  getNearbyChunkKeys,
  initSpawnWorker,
  serializeDescriptors,
  updateSpawnFootprint,
} from "./generateSpawnPoints";
import { ActorDescriptor, ActorProps, SpawnPoint } from "./types";

const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps — responsive to player movement
const RESPAWN_COOLDOWN_MS = 1000; // min age of a despawn ledger entry before it can be cleared
const DESPAWN_HYSTERESIS = 1.2; // despawn radius = spawn radius * this
const IMMEDIATE_RADIUS_FACTOR = 0.5; // immediate radius = spawn radius * this

/**
 * Max objects mounted per batch. Mounting is a React commit plus, for
 * procedural actors, geometry generation — landing a whole backlog in one
 * commit is a multi-hundred-millisecond freeze. Candidates are mounted
 * NEAREST-FIRST and the remainder is simply re-evaluated next batch against
 * the new camera position, so anything the player has already left behind is
 * never mounted at all rather than mounted-then-swept.
 */
const MAX_MOUNTS_PER_BATCH = 8;

/**
 * Hard ceiling on how long spawning defers to high-res terrain. Deferring is
 * right in the normal case, but a player who outruns terrain generation keeps
 * LOD1/2 permanently pending — spawning then never runs, which also means its
 * cache eviction never runs, and everything arrives at once when terrain
 * finally settles. Past this many frames we take a batch anyway.
 */
const MAX_FRAMES_DEFERRED_TO_TERRAIN = 90;

/**
 * Three-radius spawn lifecycle (all radii are size-aware — footprint/2 is the
 * object's own reach, so big objects spawn sooner and linger longer):
 *
 *   immediateRadius = spawnRadius * IMMEDIATE_RADIUS_FACTOR (or desc.immediateRadius)
 *                     — inner zone: INITIAL spawns are allowed (catch-up when
 *                     the player outruns spawn batches), REspawns are not
 *   spawnRadius     = renderDistance + footprint/2 — points inside it mount;
 *                     between immediate and spawn radius, respawns are fine
 *                     (keeps a camped area populated as NPCs wander off)
 *   despawnRadius   = spawnRadius * DESPAWN_HYSTERESIS (or desc.despawnDistance)
 *                     — mounted objects beyond it unmount (pool sweep;
 *                     components also self-despawn there via despawnDistance)
 *
 * When an object self-destroys (NPC walked away / fade-out kill), its id goes
 * into the despawn ledger and it can't remount until its spawn point is
 * OUTSIDE the immediate radius — so nothing pops back in right next to the
 * player, but the surrounding area keeps repopulating. Nothing is ever
 * permanently despawned.
 */

const getSpawnRadius = (desc: ActorDescriptor): number => desc.renderDistance + desc.footprint / 2;
const getDespawnRadius = (desc: ActorDescriptor): number =>
  desc.despawnDistance ?? getSpawnRadius(desc) * DESPAWN_HYSTERESIS;
const getImmediateRadius = (desc: ActorDescriptor): number =>
  desc.immediateRadius ?? getSpawnRadius(desc) * IMMEDIATE_RADIUS_FACTOR;

interface MountedObject {
  node: React.ReactNode;
  x: number;
  z: number;
  descriptorId: string;
}

/** A self-destroyed object, blocked from respawning until the player leaves.
 *  Coordinates are stored rather than re-parsed out of the id string — the
 *  ledger is swept on every batch and its whole job is a distance test. */
interface DespawnRecord {
  despawnedAt: number;
  x: number;
  z: number;
  descriptorId: string;
}

/** objId format: `${x}_${z}_${descriptorId}` (descriptor ids may contain underscores). */
const objIdOf = (point: SpawnPoint): string =>
  `${point.x}_${point.z}_${point.descriptorId}`;

export const ObjectPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, MountedObject>());
  // Despawn ledger: objects that self-destroyed (onDestroy). Blocks respawn
  // until the spawn point leaves the spawn radius.
  const despawnLedgerRef = useRef(new Map<string, DespawnRecord>());
  const isGeneratingRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastBatchFrameRef = useRef(0);
  const deferredSinceFrameRef = useRef(0);
  const workerReadyRef = useRef(false);
  const dirtyRef = useRef(false);

  const { camera } = useThree();
  const { terrain_loaded, progress, terrainHighLODPending, spawnPending } = useGameContext();

  // Collect all spawn descriptors from the active world (registered by
  // <Actor> components; mounted by <World> after the first commit)
  const descriptors = useMemo(() => collectDescriptors(getActiveRegions()), []);

  // Build descriptor lookup map
  const descriptorMap = useMemo(() => {
    const map = new Map<string, ActorDescriptor>();
    for (const d of descriptors) map.set(d.id, d);
    return map;
  }, [descriptors]);

  // Serialized descriptors for worker communication (no React components)
  const serializedDescriptors = useMemo(() => serializeDescriptors(descriptors), [descriptors]);

  // Max spawn radius across all descriptors — drives chunk fetching
  const maxSpawnRadius = useMemo(() => Math.max(...descriptors.map((d) => getSpawnRadius(d)), 500), [descriptors]);

  // Max despawn radius — worker cache must never evict chunks that still have mounted objects
  const maxDespawnRadius = useMemo(() => Math.max(...descriptors.map((d) => getDespawnRadius(d)), 600), [descriptors]);

  // Max footprint for spatial hash cell sizing
  const maxFootprint = useMemo(() => Math.max(...descriptors.map((d) => d.footprint), 10), [descriptors]);

  // Initialize spawn worker
  useEffect(() => {
    const config = getActiveWorldConfig();
    initSpawnWorker(config, maxFootprint).then(() => {
      workerReadyRef.current = true;
    });
  }, [maxFootprint]);

  // Update spatial hash when footprint changes
  useEffect(() => {
    if (workerReadyRef.current) {
      updateSpawnFootprint(maxFootprint);
    }
  }, [maxFootprint]);

  // Preload all GLTF models referenced by descriptors
  useEffect(() => {
    for (const desc of descriptors) {
      if (desc.model) {
        useGLTF.preload(desc.model);
      }
    }
  }, [descriptors]);

  // Clear ledger entries whose spawn point is outside the immediate radius —
  // respawning there is allowed, so the entry has served its purpose. Points
  // still inside the immediate radius stay blocked until the player moves away.
  const cleanupDespawnLedger = useCallback(() => {
    const now = Date.now();
    despawnLedgerRef.current.forEach((rec, objId) => {
      if (now - rec.despawnedAt < RESPAWN_COOLDOWN_MS) return;

      const desc = descriptorMap.get(rec.descriptorId);
      if (!desc) {
        despawnLedgerRef.current.delete(objId);
        return;
      }

      const dx = camera.position.x - rec.x;
      const dz = camera.position.z - rec.z;
      const immediateRadius = getImmediateRadius(desc);
      if (dx * dx + dz * dz > immediateRadius * immediateRadius) {
        despawnLedgerRef.current.delete(objId);
      }
    });
  }, [camera, descriptorMap]);

  // Pool-side despawn sweep: unmount anything beyond its despawn radius. Not
  // a "destroy" — no ledger entry — so re-entering the spawn radius remounts
  // it. This is the backstop that keeps the mounted count bounded even for
  // components that never self-despawn.
  const sweepOutOfRange = useCallback((): boolean => {
    let removed = false;
    objectsMapRef.current.forEach((obj, objId) => {
      const desc = descriptorMap.get(obj.descriptorId);
      if (!desc) return;
      const dx = obj.x - camera.position.x;
      const dz = obj.z - camera.position.z;
      const despawnRadius = getDespawnRadius(desc);
      if (dx * dx + dz * dz > despawnRadius * despawnRadius) {
        objectsMapRef.current.delete(objId);
        removed = true;
      }
    });
    return removed;
  }, [camera, descriptorMap]);

  const generateSpawners = useCallback(async () => {
    if (isGeneratingRef.current) return;
    if (!workerReadyRef.current) return;
    if (descriptors.length === 0) return;

    isGeneratingRef.current = true;
    spawnPending.current = true;
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;

    try {
      cleanupDespawnLedger();
      cleanupSpawnCache(camera.position.x, camera.position.z, maxDespawnRadius * 2);

      const chunkKeys = getNearbyChunkKeys(camera.position.x, camera.position.z, maxSpawnRadius);

      // Nearest-first; only a bounded slice of NEW chunks is generated per
      // call, so a player who outran spawning streams back in instead of
      // paying off one giant backlog.
      const buckets = await generateSpawnPoints(chunkKeys, serializedDescriptors);

      let hasChanges = sweepOutOfRange();

      // Collect mountable candidates first, then mount the nearest
      // MAX_MOUNTS_PER_BATCH. The rest are simply re-tested next batch — by
      // then the player may have moved past them, in which case they are
      // never mounted at all.
      const candidates: { point: SpawnPoint; objId: string; desc: ActorDescriptor; distSq: number }[] = [];

      for (const bucket of buckets) {
        for (const point of bucket) {
          const desc = descriptorMap.get(point.descriptorId);
          if (!desc) continue;

          // Spawn gate: point must be within the spawn radius (size-aware).
          // No inner exclusion — initial spawns are allowed at any distance so
          // spawning can catch up with fast player movement.
          const dx = point.x - camera.position.x;
          const dz = point.z - camera.position.z;
          const distSq = dx * dx + dz * dz;
          const spawnRadius = getSpawnRadius(desc);
          if (distSq > spawnRadius * spawnRadius) continue;

          const objId = objIdOf(point);

          // Never duplicate a mounted object; respawn-blocked entries stay out
          // until the player leaves their immediate radius
          if (objectsMapRef.current.has(objId)) continue;
          if (despawnLedgerRef.current.has(objId)) continue;

          candidates.push({ point, objId, desc, distSq });
        }
      }

      if (candidates.length > MAX_MOUNTS_PER_BATCH) {
        candidates.sort((a, b) => a.distSq - b.distSq);
        candidates.length = MAX_MOUNTS_PER_BATCH;
      }

      for (const { point, objId, desc } of candidates) {
        const Component = desc.component;
        const spawnRadius = getSpawnRadius(desc);
        const despawnRadius = getDespawnRadius(desc);
        const props: ActorProps = {
          id: objId,
          model: desc.model,
          coordinates: [point.x, point.height, point.z],
          scale: desc.scale,
          renderDistance: spawnRadius,
          despawnDistance: despawnRadius,
          frustumPadding: desc.frustumPadding ?? 3,
          cursorOverride: desc.cursorOverride,
          quantization: desc.quantization,
          onDestroy: (id: string) => {
            despawnLedgerRef.current.set(id, {
              despawnedAt: Date.now(),
              x: point.x,
              z: point.z,
              descriptorId: point.descriptorId,
            });
            objectsMapRef.current.delete(id);
            dirtyRef.current = true;
          },
        };

        objectsMapRef.current.set(objId, {
          node: <Component key={objId} {...props} />,
          x: point.x,
          z: point.z,
          descriptorId: point.descriptorId,
        });
        hasChanges = true;
      }

      if (hasChanges || wasDirty) {
        setStableComponents(Array.from(objectsMapRef.current.values(), (o) => o.node));
      }
    } catch (error) {
      console.error("Error in spawn generation:", error);
    } finally {
      isGeneratingRef.current = false;
      spawnPending.current = false;
    }
  }, [
    camera,
    descriptors,
    serializedDescriptors,
    descriptorMap,
    maxSpawnRadius,
    maxDespawnRadius,
    cleanupDespawnLedger,
    sweepOutOfRange,
    spawnPending,
  ]);

  useFrame(() => {
    frameCountRef.current++;

    // Gate 1: Don't spawn until initial terrain is loaded
    if (!terrain_loaded && progress < 0.5) return;

    // Gate 2: Minimum frames between spawn batches
    if (frameCountRef.current - lastBatchFrameRef.current < MIN_FRAMES_BETWEEN_BATCHES) return;

    // Gate 3: Only defer to HIGH-RES terrain (LOD1/2), not all terrain.
    // Low-LOD terrain (LOD3-5) defers to US via spawnPending.
    // The deference is time-boxed: a player outrunning terrain keeps LOD1/2
    // permanently pending, and an indefinitely starved pool never evicts its
    // caches and then floods the frame it finally runs.
    if (terrainHighLODPending.current) {
      if (deferredSinceFrameRef.current === 0) deferredSinceFrameRef.current = frameCountRef.current;
      if (frameCountRef.current - deferredSinceFrameRef.current < MAX_FRAMES_DEFERRED_TO_TERRAIN) return;
    }
    deferredSinceFrameRef.current = 0;

    // Gate 4: Worker must be initialized
    if (!workerReadyRef.current) return;

    lastBatchFrameRef.current = frameCountRef.current;
    generateSpawners();
  });

  return <>{stableComponents}</>;
};
