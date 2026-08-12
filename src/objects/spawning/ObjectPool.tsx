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
  SPAWN_CHUNK_SIZE,
  updateSpawnFootprint,
} from "./generateSpawnPoints";
import { ActorDescriptor, ActorProps, SpawnPoint } from "./types";

const MIN_FRAMES_BETWEEN_BATCHES = 5; // ~83ms at 60fps — responsive to player movement
const RESPAWN_COOLDOWN_MS = 1000; // min age of a despawn ledger entry before it can be cleared
const DESPAWN_HYSTERESIS = 1.2; // despawn radius = spawn radius * this
const IMMEDIATE_RADIUS_FACTOR = 0.5; // immediate radius = spawn radius * this

/**
 * Max objects mounted per batch. Candidates are mounted NEAREST-FIRST and the
 * remainder is re-evaluated next batch against the new camera position, so
 * anything the player has already left behind is never mounted at all rather
 * than mounted-then-swept.
 *
 * The cost here is NOT linear in the batch size, which is why this can be
 * generous: the nodes stored in objectsMapRef are stable element references,
 * so React bails out on the unchanged ones and a commit costs an O(mounted)
 * key diff rather than a re-render; and the genuinely expensive part of
 * mounting — procedural building geometry, collider creation — already runs
 * through a budgeted TaskQueue in 6ms slices, so it spreads across frames
 * however many are mounted at once. Setting this too LOW is its own cost: the
 * O(mounted) walk is then paid repeatedly to place a handful of objects, and
 * population visibly trickles in.
 */
const MAX_MOUNTS_PER_BATCH = 20;

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

/** Half-diagonal of a spawn chunk — a chunk whose CENTER is this much past
 *  the largest spawn radius cannot contain a single mountable point, so the
 *  candidate scan skips the whole bucket without touching its points. */
const CHUNK_HALF_DIAGONAL = (SPAWN_CHUNK_SIZE * Math.SQRT2) / 2;

interface MountedObject {
  node: React.ReactNode;
  /** The client cache's own point object — the identity key that must be
   *  removed from mountedPointsRef when this entry unmounts. Coordinates and
   *  descriptor are read through it (same values the entry used to mount). */
  point: SpawnPoint;
}

/** A self-destroyed object, blocked from respawning until the player leaves.
 *  Coordinates are stored rather than re-parsed out of the id string — the
 *  ledger is swept on every batch and its whole job is a distance test. */
interface DespawnRecord {
  despawnedAt: number;
  x: number;
  z: number;
  descriptorId: string;
  /** Current identity key in ledgerPointsRef — kept in sync so clearing the
   *  ledger entry can clear the identity entry without a scan. Re-pointed if
   *  the cache evicts and later re-delivers the chunk (new point objects). */
  point: SpawnPoint;
}

/** objId format: `${x}_${z}_${descriptorId}` (descriptor ids may contain underscores).
 *  Deliberately NOT called in the per-point candidate scan — float→string
 *  building for ~3,000 points per batch was the scan's dominant cost; the
 *  scan uses point-identity collections instead, and the string id is built
 *  once per actual mount (React key / props.id / objectsMap key). */
const objIdOf = (point: SpawnPoint): string =>
  `${point.x}_${point.z}_${point.descriptorId}`;

export const ObjectPool = () => {
  const [stableComponents, setStableComponents] = useState<React.ReactNode[]>([]);

  const objectsMapRef = useRef(new Map<string, MountedObject>());
  // Identity fast paths for the candidate scan. The client spawn cache hands
  // back ITS OWN stable point objects (see generateSpawnPoints), so "is this
  // point mounted / respawn-blocked?" is a reference lookup — no per-point
  // string building. Both are kept exactly in sync with their string-keyed
  // sources of truth (objectsMap / despawnLedger): entries are removed
  // whenever an object unmounts or a ledger entry clears, and the mount loop
  // repairs them if the cache evicted + re-delivered a chunk (new point
  // objects), so stale point references can never accumulate or mask state.
  const mountedPointsRef = useRef(new Set<SpawnPoint>());
  const ledgerPointsRef = useRef(new Map<SpawnPoint, DespawnRecord>());
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
  const { terrain_loaded, progress, terrainHighLODPending } = useGameContext();

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

  // Same max WITHOUT the 500u chunk-fetch floor — the candidate scan's
  // per-bucket early-out wants the tightest bound on "could any descriptor
  // mount a point in this chunk"
  const maxDescSpawnRadius = useMemo(
    () => descriptors.reduce((m, d) => Math.max(m, getSpawnRadius(d)), 0),
    [descriptors]
  );

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
        ledgerPointsRef.current.delete(rec.point);
        return;
      }

      const dx = camera.position.x - rec.x;
      const dz = camera.position.z - rec.z;
      const immediateRadius = getImmediateRadius(desc);
      if (dx * dx + dz * dz > immediateRadius * immediateRadius) {
        despawnLedgerRef.current.delete(objId);
        ledgerPointsRef.current.delete(rec.point);
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

      // Nearest-first; only a bounded slice of NEW chunks is generated per
      // call, so a player who outran spawning streams back in instead of
      // paying off one giant backlog.
      const buckets = await generateSpawnPoints(chunkKeys, serializedDescriptors);

      let hasChanges = sweepOutOfRange();

      // Collect mountable candidates first, then mount the nearest
      // MAX_MOUNTS_PER_BATCH. The rest are simply re-tested next batch — by
      // then the player may have moved past them, in which case they are
      // never mounted at all.
      //
      // This scan is the pool's hot path (~3,000 points every batch, nearly
      // all resolving "already mounted"), so it is pure arithmetic +
      // identity lookups — the string objId is only built for the bounded set
      // of points that actually mount below.
      const candidates: { point: SpawnPoint; desc: ActorDescriptor; distSq: number }[] = [];

      // Per-bucket early-out: a chunk whose center is beyond every spawn
      // radius plus the chunk half-diagonal cannot contain a mountable point.
      // (maxDescSpawnRadius, not maxSpawnRadius — the chunk-fetch floor of
      // 500u would defeat the gate whenever all descriptors are smaller.)
      const bucketGate = maxDescSpawnRadius + CHUNK_HALF_DIAGONAL;
      const bucketGateSq = bucketGate * bucketGate;

      for (const bucket of buckets) {
        const bdx = bucket.centerX - camera.position.x;
        const bdz = bucket.centerZ - camera.position.z;
        if (bdx * bdx + bdz * bdz > bucketGateSq) continue;

        for (const point of bucket.points) {
          // Never duplicate a mounted object; respawn-blocked entries stay out
          // until the player leaves their immediate radius. Identity checks
          // first — they reject almost every point, before any other work.
          if (mountedPointsRef.current.has(point)) continue;
          if (ledgerPointsRef.current.has(point)) continue;

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

          candidates.push({ point, desc, distSq });
        }
      }

      if (candidates.length > MAX_MOUNTS_PER_BATCH) {
        candidates.sort((a, b) => a.distSq - b.distSq);
        candidates.length = MAX_MOUNTS_PER_BATCH;
      }

      for (const { point, desc } of candidates) {
        const objId = objIdOf(point);

        // String-keyed backstops for the one hole in identity checks: a chunk
        // evicted from the client cache and re-delivered later hands back NEW
        // point objects, which the identity collections can't recognize. The
        // string maps stay authoritative here, and the identity entry is
        // re-pointed at the fresh object so the next batch's hot loop filters
        // it again. (A blocked candidate can waste one of this batch's mount
        // slots in that rare race — the repair makes it a one-batch cost.)
        const ledgerRec = despawnLedgerRef.current.get(objId);
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
            // The mounted entry's stored point is authoritative — if a stale
            // onDestroy ever fired after a sweep + remount, deleting the
            // closure's `point` could orphan the NEW point in the mounted set.
            const entry = objectsMapRef.current.get(id);
            const livePoint = entry ? entry.point : point;
            const rec: DespawnRecord = {
              despawnedAt: Date.now(),
              x: point.x,
              z: point.z,
              descriptorId: point.descriptorId,
              point: livePoint,
            };
            despawnLedgerRef.current.set(id, rec);
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

  useFrame(() => {
    frameCountRef.current++;

    // Gate 1: Don't spawn until initial terrain is loaded
    if (!terrain_loaded && progress < 0.5) return;

    // Gate 2: Minimum frames between spawn batches
    if (frameCountRef.current - lastBatchFrameRef.current < MIN_FRAMES_BETWEEN_BATCHES) return;

    // Gate 3: Defer to HIGH-RES terrain (LOD1/2) only — distant coarse terrain
    // has no claim on us. Time-boxed: a player outrunning terrain keeps LOD1/2
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
