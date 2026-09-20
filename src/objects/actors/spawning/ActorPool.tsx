import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import React, { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useGameContext } from "../../../context/GameContext";
import { traceEvent } from "../../../utils/spikeTrace";
import { getActiveRegions, getActiveDomainConfig } from "../../../world/domains/utils";
import { driveActorFrames } from "../Actor";
import type { ModelActorAttributes } from "../ModelActor";
import { collectDescriptors } from "./collectDescriptors";
import {
  cleanupSpawnCache,
  generateSpawnPoints,
  getNearbyChunkKeys,
  initSpawnWorker,
  serializeDescriptors,
  SPAWN_CHUNK_SIZE,
  updateSpawnFootprint,
} from "./spawnWorker";
import { AnyActorDescriptor, ActorProps, SPAWN_ONLY_KEYS, SpawnPoint } from "./types";

// Spawn lifecycle radii and the despawn ledger are described in CLAUDE.md → Actor Spawn Lifecycle.
const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps
const RESPAWN_COOLDOWN_MS = 1000;
const DESPAWN_HYSTERESIS = 1.2; // despawn radius = spawn radius × this
const IMMEDIATE_RADIUS_FACTOR = 0.5; // immediate radius = spawn radius × this

// Generous on purpose: unchanged nodes are stable element references (React
// bails out), and heavy mount work already runs through the budgeted
// TaskQueue. Too LOW pays the O(mounted) walk repeatedly for a few objects.
const MAX_MOUNTS_PER_BATCH = 20;

// A player outrunning terrain keeps LOD1/2 permanently pending; an indefinitely
// starved pool never evicts its caches and floods the frame it finally runs.
const MAX_FRAMES_DEFERRED_TO_TERRAIN = 90;

const getSpawnRadius = (desc: AnyActorDescriptor): number => desc.renderDistance + desc.footprint / 2;
const getDespawnRadius = (desc: AnyActorDescriptor): number =>
  desc.despawnDistance ?? getSpawnRadius(desc) * DESPAWN_HYSTERESIS;
const getRespawnBlockRadius = (desc: AnyActorDescriptor): number =>
  desc.immediateRadius ?? getSpawnRadius(desc) * IMMEDIATE_RADIUS_FACTOR;

const CHUNK_HALF_DIAGONAL = (SPAWN_CHUNK_SIZE * Math.SQRT2) / 2;

interface MountedObject {
  node: React.ReactNode;
  /** The client cache's own point object — the identity key in mountedPointsRef. */
  point: SpawnPoint;
}

/** Coordinates stored, not re-parsed from the id: the ledger is swept every batch. */
interface DespawnRecord {
  despawnedAt: number;
  x: number;
  z: number;
  descriptorId: string;
  /** Identity key in ledgerPointsRef; re-pointed when the cache re-delivers the chunk. */
  point: SpawnPoint;
}

/** `${x}_${z}_${descriptorId}` — descriptor ids may contain underscores. NOT
 *  called in the candidate scan: float→string for ~3,000 points per batch was
 *  its dominant cost, so the scan uses point identity instead. */
const objIdOf = (point: SpawnPoint): string =>
  `${point.x}_${point.z}_${point.descriptorId}`;

export const ActorPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, MountedObject>());
  // Identity fast paths mirroring objectsMap / despawnLedger: the spawn cache
  // hands back its own stable point objects, so the hot scan is reference
  // lookups. The mount loop repairs them when a re-delivered chunk brings new objects.
  const mountedPointsRef = useRef(new Set<SpawnPoint>());
  const ledgerPointsRef = useRef(new Map<SpawnPoint, DespawnRecord>());
  const respawnBlockedRef = useRef(new Map<string, DespawnRecord>());
  const isGeneratingRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastBatchFrameRef = useRef(0);
  const deferredSinceFrameRef = useRef(0);
  const workerReadyRef = useRef(false);
  const dirtyRef = useRef(false);

  const { camera } = useThree();
  const { terrainLoaded, progress, terrainHighLODPending } = useGameContext();

  const descriptors = useMemo(() => collectDescriptors(getActiveRegions()), []);

  const descriptorMap = useMemo(() => {
    const map = new Map<string, AnyActorDescriptor>();
    for (const d of descriptors) map.set(d.id, d);
    return map;
  }, [descriptors]);

  const serializedDescriptors = useMemo(() => serializeDescriptors(descriptors), [descriptors]);

  const maxSpawnRadius = useMemo(() => Math.max(...descriptors.map((d) => getSpawnRadius(d)), 500), [descriptors]);

  // Without the 500u chunk-fetch floor: the tightest bound for the per-bucket early-out.
  const maxDescSpawnRadius = useMemo(
    () => descriptors.reduce((m, d) => Math.max(m, getSpawnRadius(d)), 0),
    [descriptors]
  );

  // The worker cache must never evict chunks that still have mounted objects.
  const maxDespawnRadius = useMemo(() => Math.max(...descriptors.map((d) => getDespawnRadius(d)), 600), [descriptors]);

  const maxFootprint = useMemo(() => Math.max(...descriptors.map((d) => d.footprint), 10), [descriptors]);

  useEffect(() => {
    const config = getActiveDomainConfig();
    initSpawnWorker(config, maxFootprint).then(() => {
      workerReadyRef.current = true;
    });
  }, [maxFootprint]);

  useEffect(() => {
    if (workerReadyRef.current) {
      updateSpawnFootprint(maxFootprint);
    }
  }, [maxFootprint]);

  useEffect(() => {
    for (const desc of descriptors) {
      const model = (desc as Partial<ModelActorAttributes>).model;
      if (model) {
        useGLTF.preload(model);
      }
    }
  }, [descriptors]);

  const cleanupDespawnLedger = useCallback(() => {
    const now = Date.now();
    respawnBlockedRef.current.forEach((rec, objId) => {
      if (now - rec.despawnedAt < RESPAWN_COOLDOWN_MS) return;

      const desc = descriptorMap.get(rec.descriptorId);
      if (!desc) {
        respawnBlockedRef.current.delete(objId);
        ledgerPointsRef.current.delete(rec.point);
        return;
      }

      const dx = camera.position.x - rec.x;
      const dz = camera.position.z - rec.z;
      const immediateRadius = getRespawnBlockRadius(desc);
      if (dx * dx + dz * dz > immediateRadius * immediateRadius) {
        respawnBlockedRef.current.delete(objId);
        ledgerPointsRef.current.delete(rec.point);
      }
    });
  }, [camera, descriptorMap]);

  // Not a "destroy" (no ledger entry): re-entering the spawn radius remounts it.
  const sweepOutOfRange = useCallback((): boolean => {
    let removed = false;
    objectsMapRef.current.forEach((obj, objId) => {
      const desc = descriptorMap.get(obj.point.descriptorId);
      if (!desc) return;
      const dx = obj.point.x - camera.position.x;
      const dz = obj.point.z - camera.position.z;
      const despawnRadius = getDespawnRadius(desc);
      if (dx * dx + dz * dz > despawnRadius * despawnRadius) {
        objectsMapRef.current.delete(objId);
        mountedPointsRef.current.delete(obj.point);
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
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;

    try {
      cleanupDespawnLedger();
      cleanupSpawnCache(camera.position.x, camera.position.z, maxDespawnRadius * 2);

      const chunkKeys = getNearbyChunkKeys(camera.position.x, camera.position.z, maxSpawnRadius);
      const buckets = await generateSpawnPoints(chunkKeys, serializedDescriptors);

      let hasChanges = sweepOutOfRange();

      // The hot path (~3,000 points per batch, nearly all "already mounted"):
      // pure arithmetic + identity lookups, no strings. Only the nearest
      // MAX_MOUNTS_PER_BATCH mount; the rest are re-tested against the NEXT
      // camera position, so ground the player has left is never mounted at all.
      const candidates: { point: SpawnPoint; desc: AnyActorDescriptor; distSq: number }[] = [];

      const bucketGate = maxDescSpawnRadius + CHUNK_HALF_DIAGONAL;
      const bucketGateSq = bucketGate * bucketGate;

      for (const bucket of buckets) {
        const bdx = bucket.centerX - camera.position.x;
        const bdz = bucket.centerZ - camera.position.z;
        if (bdx * bdx + bdz * bdz > bucketGateSq) continue;

        for (const point of bucket.points) {
          if (mountedPointsRef.current.has(point)) continue;
          if (ledgerPointsRef.current.has(point)) continue;

          const desc = descriptorMap.get(point.descriptorId);
          if (!desc) continue;

          // No inner exclusion for initial spawns, so spawning can catch up with a fast player.
          const dx = point.x - camera.position.x;
          const dz = point.z - camera.position.z;
          const distSq = dx * dx + dz * dz;
          const spawnRadius = getSpawnRadius(desc);
          if (distSq > spawnRadius * spawnRadius) continue;

          candidates.push({ point, desc, distSq });
        }
      }

      if (candidates.length > MAX_MOUNTS_PER_BATCH) {
        candidates.sort((a, b) => a.distSq - b.distSq);
        candidates.length = MAX_MOUNTS_PER_BATCH;
      }

      for (const { point, desc } of candidates) {
        const objId = objIdOf(point);

        // The one hole in identity checks: a chunk evicted and re-delivered
        // hands back NEW point objects. The string maps stay authoritative and
        // the identity entry is re-pointed so the next hot loop filters it.
        const ledgerRec = respawnBlockedRef.current.get(objId);
        if (ledgerRec) {
          ledgerPointsRef.current.delete(ledgerRec.point);
          ledgerRec.point = point;
          ledgerPointsRef.current.set(point, ledgerRec);
          continue;
        }
        const mounted = objectsMapRef.current.get(objId);
        if (mounted) {
          mountedPointsRef.current.delete(mounted.point);
          mounted.point = point;
          mountedPointsRef.current.add(point);
          continue;
        }

        const Component = desc.component;
        const attributes: Record<string, unknown> = { ...desc };
        delete attributes.component;
        for (const key of SPAWN_ONLY_KEYS) delete attributes[key];
        const spawnRadius = getSpawnRadius(desc);
        const despawnRadius = getDespawnRadius(desc);
        const props: ActorProps = {
          ...attributes,
          id: objId,
          descriptorId: point.descriptorId,
          coordinates: [point.x, point.height, point.z],
          renderDistance: spawnRadius,
          despawnDistance: despawnRadius,
          frustumPadding: desc.frustumPadding ?? 3,
          onDestroy: (id: string) => {
            // A stale onDestroy after a sweep + remount must not orphan the NEW point.
            const entry = objectsMapRef.current.get(id);
            const livePoint = entry ? entry.point : point;
            const rec: DespawnRecord = {
              despawnedAt: Date.now(),
              x: point.x,
              z: point.z,
              descriptorId: point.descriptorId,
              point: livePoint,
            };
            respawnBlockedRef.current.set(id, rec);
            ledgerPointsRef.current.set(livePoint, rec);
            objectsMapRef.current.delete(id);
            mountedPointsRef.current.delete(livePoint);
            dirtyRef.current = true;
          },
        };

        objectsMapRef.current.set(objId, {
          node: <Component key={objId} {...props} />,
          point,
        });
        mountedPointsRef.current.add(point);
        hasChanges = true;
      }

      if (hasChanges || wasDirty) {
        traceEvent("spawn:commit", candidates.length);
        setStableComponents(Array.from(objectsMapRef.current.values(), (o) => o.node));
      }
    } catch (error) {
      console.error("Error in spawn generation:", error);
    } finally {
      isGeneratingRef.current = false;
    }
  }, [
    camera,
    descriptors,
    serializedDescriptors,
    descriptorMap,
    maxSpawnRadius,
    maxDescSpawnRadius,
    maxDespawnRadius,
    cleanupDespawnLedger,
    sweepOutOfRange,
  ]);

  // <Domain> always mounts the pool, so this drives every actor in a domain tree.
  useFrame(driveActorFrames);

  useFrame(() => {
    frameCountRef.current++;

    if (!terrainLoaded && progress < 0.5) return;

    if (frameCountRef.current - lastBatchFrameRef.current < MIN_FRAMES_BETWEEN_BATCHES) return;

    if (terrainHighLODPending.current) {
      if (deferredSinceFrameRef.current === 0) deferredSinceFrameRef.current = frameCountRef.current;
      if (frameCountRef.current - deferredSinceFrameRef.current < MAX_FRAMES_DEFERRED_TO_TERRAIN) return;
    }
    deferredSinceFrameRef.current = 0;

    if (!workerReadyRef.current) return;

    lastBatchFrameRef.current = frameCountRef.current;
    generateSpawners();
  });

  return <>{stableComponents}</>;
};
