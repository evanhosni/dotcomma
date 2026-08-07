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
import { ActorDescriptor, ActorProps } from "./types";

const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps — responsive to player movement
const RESPAWN_COOLDOWN_MS = 1000; // min age of a despawn ledger entry before it can be cleared
const DESPAWN_HYSTERESIS = 1.2; // despawn radius = spawn radius * this
const IMMEDIATE_RADIUS_FACTOR = 0.5; // immediate radius = spawn radius * this

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

/** objId format: `${x}_${z}_${descriptorId}` (descriptor ids may contain underscores). */
const parseObjId = (objId: string): { x: number; z: number; descriptorId: string } | null => {
  const parts = objId.split("_");
  if (parts.length < 3) return null;
  return { x: Number(parts[0]), z: Number(parts[1]), descriptorId: parts.slice(2).join("_") };
};

export const ObjectPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, MountedObject>());
  // Despawn ledger: objects that self-destroyed (onDestroy). Blocks respawn
  // until the spawn point leaves the spawn radius.
  const despawnLedgerRef = useRef(new Map<string, number>());
  const isGeneratingRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastBatchFrameRef = useRef(0);
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
    despawnLedgerRef.current.forEach((despawnedAt, objId) => {
      if (now - despawnedAt < RESPAWN_COOLDOWN_MS) return;

      const parsed = parseObjId(objId);
      if (!parsed) {
        despawnLedgerRef.current.delete(objId);
        return;
      }
      const desc = descriptorMap.get(parsed.descriptorId);
      if (!desc) {
        despawnLedgerRef.current.delete(objId);
        return;
      }

      const dx = camera.position.x - parsed.x;
      const dz = camera.position.z - parsed.z;
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

      // Send all chunk keys to the worker in one message
      const points = await generateSpawnPoints(chunkKeys, serializedDescriptors);

      let hasChanges = sweepOutOfRange();

      for (const point of points) {
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

        const objId = `${point.x}_${point.z}_${point.descriptorId}`;

        // Respawn-blocked: it self-destroyed and the player hasn't left yet
        if (despawnLedgerRef.current.has(objId)) continue;

        // Never duplicate a mounted object
        if (objectsMapRef.current.has(objId)) continue;

        const Component = desc.component;
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
            despawnLedgerRef.current.set(id, Date.now());
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
    if (terrainHighLODPending.current) return;

    // Gate 4: Worker must be initialized
    if (!workerReadyRef.current) return;

    lastBatchFrameRef.current = frameCountRef.current;
    generateSpawners();
  });

  return <>{stableComponents}</>;
};
