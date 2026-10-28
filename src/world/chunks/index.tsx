import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { WORLD_CHUNK_SIZE, type ChunkBounds, type ColliderBody } from "./types";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { freezeStaticSubtree } from "../../utils/utils";
import { instancedTemplate, reportUnwarmedPrograms, warmPrograms } from "../../utils/warmPrograms";
import { _curvature } from "../../vfx/curvature";
import { _spawnFade } from "../../vfx/spawnFade";

/**
 * THE WORLD'S STREAMING CHUNKS: a camera-following window of fixed 256u cells that build and
 * dispose what stands in them, on ONE budgeted queue. Everything streamed by POSITION rather than
 * by terrain LOD is built on this — the dressing, the tunnels — so none of them can miss a
 * world-wide effect (curvature, the spawn fade, program warm-up, the per-chunk fade).
 *
 * A system uses `useChunkAssets` (its shared geometries and materials) + `useWorldChunks` (the
 * lifecycle), `useChunkRegistry` for per-chunk side state, and `useChunkColliders` (colliders.tsx)
 * where its chunks are solid. Terrain is NOT on this: its chunks are sized per LOD level and
 * driven by the quadtree (world/terrain/).
 */

const UPDATE_INTERVAL_FRAMES = 31;

// One budgeted queue across every streamed system, so a ring of fresh chunks can't stack mesh
// assembly into one frame.
// Weight 1.5: at equal distance a building or the ground comes first; beyond 400u a chunk is background.
const chunkQueue = new TaskQueue({ weight: 1.5 });

export const prepareChunkMaterial = (material: THREE.Material): void => {
  _curvature.patchMaterial(material);
  _spawnFade.patchMaterial(material);
};

const isMaterial = (asset: unknown): asset is THREE.Material => !!(asset as THREE.Material | undefined)?.isMaterial;

/** A feature's own ShaderMaterial in a holder: it carries the chunk projection (quantization, curvature:
 *  world/shaders/chunkProjection.ts) itself, so `useChunkAssets` disposes it but does not patch it
 *  again; only the spawn fade — the one effect the projection does not carry — is applied here. */
export interface SelfPatchedMaterial<M extends THREE.Material = THREE.ShaderMaterial> {
  material: M;
  dispose: () => void;
}
export const selfPatchedMaterial = <M extends THREE.Material>(material: M): SelfPatchedMaterial<M> => {
  _spawnFade.patchMaterial(material);
  return { material, dispose: () => material.dispose() };
};

/** `warm`: the objects this feature draws, as program templates (utils/warmPrograms.ts) — linked at
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

/** Instance buffers only — shared geometries/materials belong to the system that owns them. */
const disposeChunkObject = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    // A per-chunk merged mesh (the bridge ribbons) marks itself the owner of its geometry.
    else if ((o as THREE.Mesh).isMesh && o.userData.ownsGeometry) (o as THREE.Mesh).geometry.dispose();
  });
};

/** Chunks are dropped this far past the render distance, so chunk borders don't thrash. */
const DROP_HYSTERESIS = 1.3;

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
    }, { at: { x: centerX, z: centerZ } });
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

