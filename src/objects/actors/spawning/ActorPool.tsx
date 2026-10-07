// A per-module path: drei 9.87's index re-exports SpotLight, which imports LinearEncoding (removed in three r162).
import { useGLTF } from "@react-three/drei/core/useGLTF";
import { useFrame, useThree } from "@react-three/fiber";
import React, { Suspense, useCallback, useMemo, useRef, useState, useEffect } from "react";
import { useGameContext } from "../../../context/GameContext";
import { traceEvent } from "../../../utils/spikeTrace";
import { getActiveRegions, getActiveDomainConfig } from "../../../world/domains/utils";
import { DEFAULT_FRUSTUM_PADDING, driveActorFrames } from "../Actor";
import type { ModelActorAttributes } from "../ModelActor";
import { collectDescriptors } from "./collectDescriptors";
import { SPAWN_CHUNK_SIZE } from "../../../utils/workers/constants";
import { setWorkFocus } from "../../../utils/task-queue/TaskQueue";
import {
  cleanupSpawnCache,
  getCachedSpawnChunks,
  getNearbyChunkKeys,
  requestSpawnChunks,
  initSpawnWorker,
  serializeDescriptors,
  updateSpawnFootprint,
} from "./spawnWorker";
import { AnyActorDescriptor, ActorProps, ActorWarmupHooks, SPAWN_ONLY_KEYS, SpawnPoint } from "./types";

// Spawn lifecycle radii and the despawn ledger are described in CLAUDE.md → Actor Spawn Lifecycle.
const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps
/** Spawning waits for half the initial terrain (foliage lands first, at 0). */
const MIN_TERRAIN_PROGRESS = 0.5;
const RESPAWN_COOLDOWN_MS = 1000;
const DESPAWN_HYSTERESIS = 1.2; // despawn radius = spawn radius × this
const IMMEDIATE_RADIUS_FACTOR = 0.5; // immediate radius = spawn radius × this

// Generous on purpose: unchanged nodes are stable element references (React
// bails out), and heavy mount work already runs through the budgeted
// TaskQueue. Too LOW pays the O(mounted) walk repeatedly for a few objects.
const MAX_MOUNTS_PER_BATCH = 20;

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

interface SpawnCandidate {
  point: SpawnPoint;
  desc: AnyActorDescriptor;
  distSq: number;
}

/** The hot path (~3,000 points per batch, nearly all "already mounted"): pure arithmetic + identity
 *  lookups, no strings. Every cached point inside its descriptor's spawn radius that is neither mounted
 *  nor respawn-blocked — with NO inner exclusion for first spawns, so spawning catches up with a fast player. */
const collectSpawnCandidates = (
  buckets: ReturnType<typeof getCachedSpawnChunks>,
  cameraX: number,
  cameraZ: number,
  bucketGateSq: number,
  descriptorMap: Map<string, AnyActorDescriptor>,
  mountedPoints: Set<SpawnPoint>,
  ledgerPoints: Map<SpawnPoint, DespawnRecord>,
): SpawnCandidate[] => {
  const candidates: SpawnCandidate[] = [];
  for (const bucket of buckets) {
    const bdx = bucket.centerX - cameraX;
    const bdz = bucket.centerZ - cameraZ;
    if (bdx * bdx + bdz * bdz > bucketGateSq) continue;

    for (const point of bucket.points) {
      if (mountedPoints.has(point)) continue;
      if (ledgerPoints.has(point)) continue;

      const desc = descriptorMap.get(point.descriptorId);
      if (!desc) continue;

      const dx = point.x - cameraX;
      const dz = point.z - cameraZ;
      const distSq = dx * dx + dz * dz;
      const spawnRadius = getSpawnRadius(desc);
      if (distSq > spawnRadius * spawnRadius) continue;

      candidates.push({ point, desc, distSq });
    }
  }
  return candidates;
};

/** A descriptor's attributes minus the spawn-only ones, plus the per-instance props (the pool is the
 *  one source of every radius). */
const actorPropsOf = (
  desc: AnyActorDescriptor,
  point: SpawnPoint,
  id: string,
  onDestroy: (id: string) => void,
): ActorProps => {
  const attributes: Record<string, unknown> = { ...desc };
  delete attributes.component;
  for (const key of SPAWN_ONLY_KEYS) delete attributes[key];
  return {
    ...attributes,
    id,
    descriptorId: point.descriptorId,
    coordinates: [point.x, point.height, point.z],
    renderDistance: getSpawnRadius(desc),
    despawnDistance: getDespawnRadius(desc),
    frustumPadding: desc.frustumPadding ?? DEFAULT_FRUSTUM_PADDING,
    onDestroy,
  };
};

/** Warm-up components are module-level members' statics: a handful, alive for the page. */
const warmupIds = new Map<React.FC<{ descriptor: AnyActorDescriptor }>, number>();

/** One load-time warm-up node per distinct (member warm-up, warmupKey) among the descriptors. */
const warmupNodesOf = (descriptors: AnyActorDescriptor[]): React.ReactNode[] => {
  const nodes = new Map<string, React.ReactNode>();
  for (const desc of descriptors) {
    const hooks = desc.component as ActorWarmupHooks;
    if (!hooks.Warmup) continue;
    let hookId = warmupIds.get(hooks.Warmup);
    if (hookId === undefined) warmupIds.set(hooks.Warmup, (hookId = warmupIds.size));
    const key = `${hookId}:${hooks.warmupKey?.(desc) ?? ""}`;
    if (!nodes.has(key)) nodes.set(key, <hooks.Warmup key={key} descriptor={desc} />);
  }
  return Array.from(nodes.values());
};

export const ActorPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, MountedObject>());
  // Identity fast paths mirroring objectsMap / despawnLedger: the spawn cache
  // hands back its own stable point objects, so the hot scan is reference
  // lookups. The mount loop repairs them when a re-delivered chunk brings new objects.
  const mountedPointsRef = useRef(new Set<SpawnPoint>());
  const ledgerPointsRef = useRef(new Map<SpawnPoint, DespawnRecord>());
  const respawnBlockedRef = useRef(new Map<string, DespawnRecord>());
  const requestInFlightRef = useRef(false);
  const frameCountRef = useRef(0);
  const lastBatchFrameRef = useRef(0);
  const workerReadyRef = useRef(false);
  const dirtyRef = useRef(false);

  const { camera } = useThree();
  const { terrainLoaded, progress } = useGameContext();

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

  /** Unblocks cooled-down ledger entries whose point is outside the immediate radius (or whose kind is gone). */
  const cleanupDespawnLedger = useCallback(() => {
    const now = Date.now();
    respawnBlockedRef.current.forEach((rec, objId) => {
      if (now - rec.despawnedAt < RESPAWN_COOLDOWN_MS) return;
      const desc = descriptorMap.get(rec.descriptorId);
      if (desc) {
        const dx = camera.position.x - rec.x;
        const dz = camera.position.z - rec.z;
        const immediateRadius = getRespawnBlockRadius(desc);
        if (dx * dx + dz * dz <= immediateRadius * immediateRadius) return;
      }
      respawnBlockedRef.current.delete(objId);
      ledgerPointsRef.current.delete(rec.point);
    });
  }, [camera, descriptorMap]);

  /** The one hole in identity checks: a chunk evicted and re-delivered hands back NEW point objects. The
   *  string maps stay authoritative and the identity entry is re-pointed so the next hot loop filters it.
   *  True when the point was already mounted or respawn-blocked. */
  const repointRedelivered = useCallback((objId: string, point: SpawnPoint): boolean => {
    const ledgerRec = respawnBlockedRef.current.get(objId);
    if (ledgerRec) {
      ledgerPointsRef.current.delete(ledgerRec.point);
      ledgerRec.point = point;
      ledgerPointsRef.current.set(point, ledgerRec);
      return true;
    }
    const mounted = objectsMapRef.current.get(objId);
    if (mounted) {
      mountedPointsRef.current.delete(mounted.point);
      mounted.point = point;
      mountedPointsRef.current.add(point);
      return true;
    }
    return false;
  }, []);

  /** An actor destroyed itself: unmount it and block its respawn (CLAUDE.md → Actor Spawn Lifecycle). */
  const recordDespawn = useCallback((id: string, point: SpawnPoint): void => {
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
  }, []);

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

  // Mounting never waits for the worker: a batch mounts from what is cached while the worker fills
  // in the rest (awaiting it would hold every mount behind up to SPAWN_BUDGET_MS of new chunks).
  const runSpawnBatch = useCallback(() => {
    if (!workerReadyRef.current) return;
    if (descriptors.length === 0) return;

    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;

    try {
      cleanupDespawnLedger();
      const chunkKeys = getNearbyChunkKeys(camera.position.x, camera.position.z, maxSpawnRadius);

      if (!requestInFlightRef.current) {
        cleanupSpawnCache(camera.position.x, camera.position.z, maxDespawnRadius * 2);
        const request = requestSpawnChunks(chunkKeys, serializedDescriptors);
        if (request) {
          requestInFlightRef.current = true;
          request
            .catch((error) => console.error("Error in spawn generation:", error))
            .finally(() => {
              requestInFlightRef.current = false;
            });
        }
      }
      const buckets = getCachedSpawnChunks(chunkKeys);

      let hasChanges = sweepOutOfRange();

      const bucketGate = maxDescSpawnRadius + CHUNK_HALF_DIAGONAL;
      const candidates = collectSpawnCandidates(
        buckets,
        camera.position.x,
        camera.position.z,
        bucketGate * bucketGate,
        descriptorMap,
        mountedPointsRef.current,
        ledgerPointsRef.current,
      );

      // Only the nearest MAX_MOUNTS_PER_BATCH mount; the rest are re-tested against the NEXT
      // camera position, so ground the player has left is never mounted at all.
      if (candidates.length > MAX_MOUNTS_PER_BATCH) {
        candidates.sort((a, b) => a.distSq - b.distSq);
        candidates.length = MAX_MOUNTS_PER_BATCH;
      }

      for (const { point, desc } of candidates) {
        const objId = objIdOf(point);
        if (repointRedelivered(objId, point)) continue;

        const Component = desc.component;
        const props = actorPropsOf(desc, point, objId, (id: string) => recordDespawn(id, point));

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
    repointRedelivered,
    recordDespawn,
  ]);

  // <Domain> always mounts the pool, so this drives every actor in a domain tree.
  useFrame((state, delta) => {
    setWorkFocus(state.camera.position.x, state.camera.position.z);
    driveActorFrames(state, delta);
  });

  useFrame(() => {
    frameCountRef.current++;

    if (!terrainLoaded && progress < MIN_TERRAIN_PROGRESS) return;

    if (frameCountRef.current - lastBatchFrameRef.current < MIN_FRAMES_BETWEEN_BATCHES) return;

    if (!workerReadyRef.current) return;

    lastBatchFrameRef.current = frameCountRef.current;
    runSpawnBatch();
  });

  const warmups = useMemo(() => warmupNodesOf(descriptors), [descriptors]);

  return (
    <>
      {stableComponents}
      <Suspense fallback={null}>{warmups}</Suspense>
    </>
  );
};
