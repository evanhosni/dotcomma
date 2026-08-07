import { useFrame } from "@react-three/fiber";
import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { TaskQueue } from "../utils/task-queue/TaskQueue";

/**
 * DRESSING — the instanced spawn class.
 *
 * Dressing is mass, stateless, identical scenery (street lamps, road
 * markers, traffic lights, power lines): no per-object React
 * components, no per-object state. Placement is enumerated OFF-THREAD in
 * workers/cityDressing.worker.ts (via dressingWorker.ts) and rendered as one
 * InstancedMesh (or a few) per chunk. Objects with their own identity,
 * state, or interaction belong to the other class — ACTORS (see
 * src/world/components/Actor.tsx).
 *
 * A dressing feature component is expected to contain ONLY its unique
 * logic: which points to fetch, its geometry/materials, and (rarely) a
 * per-frame animation. Everything shared lives here:
 *   - <Dressing>            group providing shared default props
 *   - useDressingChunks     camera-following chunk lifecycle
 *   - useDressingAssets     geometry/material creation + disposal
 *   - instancedFromPoints   standard point-list → InstancedMesh assembly
 *   - useChunkRegistry      per-chunk side-state with unmount cleanup
 */

export const DRESSING_CHUNK_SIZE = 256; // world units per chunk (one build call)
const UPDATE_INTERVAL_FRAMES = 31;

// ONE shared budgeted queue across all dressing features: the worker does the
// heavy enumeration; this only serializes requests and yields between mesh
// builds so a ring of fresh chunks can't stack assembly work into one frame.
const dressingQueue = new TaskQueue();

// ── <Dressing> group ──

export interface DressingDefaults {
  /** Camera distance within which feature chunks are built (features fall
   *  back to their own defaults when neither prop nor group sets it). */
  renderDistance?: number;
}

const DressingContext = createContext<DressingDefaults>({});

/**
 * Groups a biome's dressing features, mirroring <Actors>: props set here act
 * as shared defaults for the children — a child's own props always win.
 *
 *   <Dressing renderDistance={400}>
 *     <StreetLamps />
 *     <RoadMarkers />
 *   </Dressing>
 */
export const Dressing = ({ children, ...defaults }: React.PropsWithChildren<DressingDefaults>) => {
  const dataKey = JSON.stringify(defaults);
  const value = useMemo(() => defaults, [dataKey]);
  return <DressingContext.Provider value={value}>{children}</DressingContext.Provider>;
};

/** Resolve a feature's renderDistance: own prop > <Dressing> group > feature default. */
export const useDressingRenderDistance = (
  own: number | undefined,
  featureDefault: number
): number => {
  const ctx = useContext(DressingContext);
  return own ?? ctx.renderDistance ?? featureDefault;
};

// ── Shared assets ──

/** Create geometries/materials once and dispose them on unmount. */
export const useDressingAssets = <T extends Record<string, { dispose: () => void }>>(
  create: () => T
): T => {
  const assets = useMemo(create, []);
  useEffect(
    () => () => {
      for (const key of Object.keys(assets)) assets[key].dispose();
    },
    [assets]
  );
  return assets;
};

// ── Instancing helpers ──

/** rotateY(θ) maps +X to (cosθ, 0, −sinθ) — the yaw aligning local +X with a direction. */
export const yawFromDir = (dirX: number, dirZ: number): number => Math.atan2(-dirZ, dirX);

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

/**
 * Standard chunk assembly: one InstancedMesh from a point list. `place` maps
 * each point to a position + yaw (local +X faces along yaw). Culling is
 * disabled — instanced bounds don't auto-fit scattered instances, and chunks
 * are small enough to always draw.
 */
export const instancedFromPoints = <P,>(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  points: P[],
  place: (point: P, index: number) => InstancePlacement
): THREE.InstancedMesh => {
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < points.length; i++) {
    const p = place(points[i], i);
    q.setFromAxisAngle(up, p.yaw ?? 0);
    pos.set(p.x, p.y, p.z);
    m.compose(pos, q, one);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
};

/** Low-level per-instance write for non-standard transforms (scaled wire
 *  segments, etc.). Set mesh.instanceMatrix.needsUpdate = true after the
 *  last write. */
const scratchMatrix = new THREE.Matrix4();
export const setInstanceTransform = (
  mesh: THREE.InstancedMesh,
  index: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3
): void => {
  scratchMatrix.compose(position, quaternion, scale);
  mesh.setMatrixAt(index, scratchMatrix);
};

// ── Per-chunk side-state registry ──

export interface ChunkRegistryEntry {
  /** The chunk's wrapper object — its parent goes null when the chunk
   *  lifecycle unmounts it, which is the prune signal. */
  group: THREE.Object3D;
}

/**
 * Side-state tied to chunk lifetime (animation clocks, lamp-head
 * registrations, collider point lists). `forEachAlive` iterates live entries
 * and lazily prunes unmounted ones, invoking `onRemove` — call it from the
 * feature's own useFrame; no extra frame loop is added.
 */
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
  return registryRef.current;
};

// ── Chunk lifecycle ──

export interface DressingChunkBounds {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

interface DressingChunk {
  object: THREE.Object3D | null;
  disposed: boolean;
}

/** Release per-chunk GPU buffers (instance attributes). Shared geometries /
 *  materials belong to the feature component and are NOT disposed here. */
const disposeChunkObject = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
};

/**
 * Camera-following chunk lifecycle: every DRESSING_CHUNK_SIZE world units
 * gets one `build` call (inside the shared budgeted queue; the placement
 * worker runs the biome probe + enumeration off-thread) whose returned
 * object is mounted until the camera leaves `renderDistance × 1.3`
 * (hysteresis so borders don't thrash). Returns the group ref to render:
 * `<group ref={groupRef} />`.
 */
export const useDressingChunks = ({
  renderDistance,
  build,
}: {
  renderDistance: number;
  /** Build the chunk's content, or null when the chunk is empty. Must be
   *  deterministic per bounds (chunks rebuild identically on revisit). */
  build: (bounds: DressingChunkBounds) => Promise<THREE.Object3D | null>;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const chunks = useRef(new Map<string, DressingChunk>()).current;
  // Random stagger so multiple feature components don't all scan on the
  // same frame.
  const frameCount = useRef(Math.floor(Math.random() * UPDATE_INTERVAL_FRAMES));
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const group = groupRef.current;
    return () => {
      chunks.forEach((chunk) => {
        chunk.disposed = true;
        if (chunk.object) {
          if (group) group.remove(chunk.object);
          disposeChunkObject(chunk.object);
        }
      });
      chunks.clear();
    };
  }, [chunks]);

  useFrame(({ camera }) => {
    if (frameCount.current++ % UPDATE_INTERVAL_FRAMES !== 0) return;
    const group = groupRef.current;
    if (!group) return;

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const radius = Math.ceil(renderDistance / DRESSING_CHUNK_SIZE);
    const ccx = Math.floor(camX / DRESSING_CHUNK_SIZE);
    const ccz = Math.floor(camZ / DRESSING_CHUNK_SIZE);

    // Build chunks entering range
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const centerX = (cx + 0.5) * DRESSING_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * DRESSING_CHUNK_SIZE;
        if (Math.hypot(camX - centerX, camZ - centerZ) > renderDistance) continue;

        const key = `${cx}_${cz}`;
        if (chunks.has(key)) continue;

        const entry: DressingChunk = { object: null, disposed: false };
        chunks.set(key, entry);

        dressingQueue.addTask(async () => {
          if (entry.disposed) return;
          const object = await buildRef.current({
            minX: cx * DRESSING_CHUNK_SIZE,
            minZ: cz * DRESSING_CHUNK_SIZE,
            maxX: (cx + 1) * DRESSING_CHUNK_SIZE,
            maxZ: (cz + 1) * DRESSING_CHUNK_SIZE,
          });
          if (!object) return;
          if (entry.disposed || !groupRef.current) {
            disposeChunkObject(object);
            return;
          }
          groupRef.current.add(object);
          entry.object = object;
        });
      }
    }

    // Drop chunks leaving range (hysteresis so borders don't thrash)
    chunks.forEach((entry, key) => {
      const [cx, cz] = key.split("_").map(Number);
      const centerX = (cx + 0.5) * DRESSING_CHUNK_SIZE;
      const centerZ = (cz + 0.5) * DRESSING_CHUNK_SIZE;
      if (Math.hypot(camX - centerX, camZ - centerZ) > renderDistance * 1.3) {
        entry.disposed = true;
        if (entry.object) {
          group.remove(entry.object);
          disposeChunkObject(entry.object);
        }
        chunks.delete(key);
      }
    });
  });

  return groupRef;
};
