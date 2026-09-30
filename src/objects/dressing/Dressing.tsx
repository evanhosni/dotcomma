import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody, TrimeshCollider } from "@react-three/rapier";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  DRESSING_CHUNK_SIZE,
  type DressingBounds,
  type DressingColliderBody,
  type DressingColliderMesh,
  type DressingColliderPart,
  type DressingColliderSpec,
} from "./types";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { _curvature } from "../../vfx/curvature";
import { DressingAttributes } from "../types";
import { createDefaultsGroup } from "../utils";

/**
 * THE DRESSING BASE (CLAUDE.md → "The three game-object classes"): a feature
 * component holds only its own placement query, geometry/materials and optional
 * animation; everything shared — chunk lifecycle, asset prep (curvature),
 * instanced assembly + rebase, chunk side-state, distance-gated colliders —
 * lives here so a new feature cannot miss a world-wide effect.
 */

export { DRESSING_CHUNK_SIZE } from "./types";
const UPDATE_INTERVAL_FRAMES = 31;

// One budgeted queue across ALL dressing features so a ring of fresh chunks
// can't stack mesh assembly into one frame.
// Weight 1.5: at equal distance a building or the ground comes first; beyond 400u a chunk is background.
const dressingQueue = new TaskQueue({ weight: 1.5 });

export type DressingDefaults = Pick<DressingAttributes, "renderDistance" | "colliderDistance" | "serverSynced">;

const DressingGroup = createDefaultsGroup<DressingDefaults>("dressing");
export const Dressing = DressingGroup.Group;

/** Resolve a group-defaultable attribute: own prop > <Dressing> group > feature default. */
export const useDressingDefault = <K extends keyof DressingDefaults>(
  key: K,
  own: DressingDefaults[K],
  featureDefault: NonNullable<DressingDefaults[K]>
): NonNullable<DressingDefaults[K]> => {
  const ctx = DressingGroup.useDefaults();
  return (own ?? ctx[key] ?? featureDefault) as NonNullable<DressingDefaults[K]>;
};

/** The ONE place dressing materials are patched with world-wide effects. Quantization is
 *  deliberately absent: its instanced branch works in absolute space (vfx/quantization.ts). */
export const prepareDressingMaterial = (material: THREE.Material): void => {
  _curvature.patchMaterial(material);
};

export const useDressingAssets = <T extends Record<string, { dispose: () => void }>>(
  create: () => T
): T => {
  const assets = useMemo(() => {
    const created = create();
    for (const key of Object.keys(created)) {
      const asset = created[key] as unknown as THREE.Material;
      if (asset?.isMaterial) prepareDressingMaterial(asset);
    }
    return created;
  }, []);
  useEffect(
    () => () => {
      for (const key of Object.keys(assets)) assets[key].dispose();
    },
    [assets]
  );
  return assets;
};

// Three-free in ./types so the SERVER builds the same collider boxes.
export { yawFromDir } from "./types";
export type { DressingColliderPart } from "./types";

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

/** One InstancedMesh from a point list; local +X faces along `yaw`. */
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
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = place(points[i], i);
    q.setFromAxisAngle(up, p.yaw ?? 0);
    pos.set(p.x, p.y, p.z);
    m.compose(pos, q, one);
    mesh.setMatrixAt(i, m);
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (points.length > 0) {
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const gbs = geometry.boundingSphere!;
    // Any per-instance yaw can swing the geometry's sphere center around a circle of radius |center|.
    finalizeInstancedChunk(mesh, minX, minY, minZ, maxX, maxY, maxZ, gbs.center.length() + gbs.radius);
  }
  return mesh;
};

/** REBASES the absolute instance translations onto the extents center (meshes at the world
 *  origin visibly jittered past ~100k units — CLAUDE.md → Coordinate Precision), sets the
 *  explicit LOCAL culling sphere (instanced bounds never auto-fit) and warms the GPU upload.
 *  Every instanced chunk must end here. */
export const finalizeInstancedChunk = (
  mesh: THREE.InstancedMesh,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  boundsPad: number
): void => {
  const originX = (minX + maxX) / 2;
  const originY = (minY + maxY) / 2;
  const originZ = (minZ + maxZ) / 2;
  const matrices = mesh.instanceMatrix.array as Float32Array;
  for (let i = 0; i < mesh.count; i++) {
    const t = i * 16 + 12; // column-major translation slot
    matrices[t] -= originX;
    matrices[t + 1] -= originY;
    matrices[t + 2] -= originZ;
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.position.set(originX, originY, originZ);
  mesh.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + boundsPad
  );
  uploadOnFirstDraw(mesh);
};

/** Caller sets mesh.instanceMatrix.needsUpdate after the last write. */
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

export interface ChunkRegistryEntry {
  /** parent === null once the chunk lifecycle unmounts it — the prune signal. */
  group: THREE.Object3D;
}

/** Per-chunk side-state pruned lazily from the feature's own frame loop (forEachAlive) and
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

/** A mounted collider body: a chunk's DressingColliderBody (types.ts) keyed for React. */
export interface DressingColliderPoint {
  key: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  parts?: DressingColliderPart[];
  mesh?: DressingColliderMesh;
}

/** `points` are the chunk's collider bodies — its spec's `bodiesOf`, so the server builds the same. */
export interface ChunkWithPoints extends ChunkRegistryEntry {
  points: DressingColliderBody[];
}

/** Thin street furniture only needs to be solid where the player can reach it. */
export const DRESSING_COLLIDER_DISTANCE = 90;

/** Dev: the server places a collider feature with its spec's `placement` only (it never sees a
 *  mount), so a mount prop overriding it draws scenery where the server has no colliders. */
export const useServerPlacementCheck = <S extends DressingColliderSpec<any>>(spec: S, placement: S["placement"]): void => {
  const placementKey = JSON.stringify(placement);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const defaults = spec.placement as Record<string, unknown>;
    const mounted = JSON.parse(placementKey) as Record<string, unknown>;
    const keys = new Set([...Object.keys(defaults), ...Object.keys(mounted)]);
    const differing = Array.from(keys).filter((k) => JSON.stringify(mounted[k]) !== JSON.stringify(defaults[k]));
    if (differing.length === 0) return;
    console.warn(
      `<${spec.id}> overrides ${differing.join(", ")} at the mount — the server's colliders still use the spec's ` +
        `placement. Change the default in the feature's *Spec.ts instead.`,
    );
  }, [spec, placementKey]);
};

export const DressingPartColliders = ({
  colliders,
  parts,
}: {
  colliders: DressingColliderPoint[];
  parts: DressingColliderPart[];
}) => (
  <>
    {colliders.map((c) => (
      // Euler XYZ: the pitch about local Z is applied first, then the yaw — the server composes the same.
      <RigidBody key={c.key} type="fixed" colliders={false} position={[c.x, c.y, c.z]} rotation={[0, c.yaw, c.pitch]}>
        {(c.parts ?? parts).map((p, i) => (
          <CuboidCollider key={i} args={[p.w / 2, p.h / 2, p.d / 2]} position={[p.x, p.y, p.z ?? 0]} rotation={[0, p.yaw ?? 0, 0]} />
        ))}
        {c.mesh && <TrimeshCollider args={[c.mesh.vertices, c.mesh.indices]} />}
      </RigidBody>
    ))}
  </>
);

/** Real colliders only within `colliderDistance` (thousands of Rapier shapes would cost more than the
 *  instancing saved). The registry sweep must run every interval even when the scan is skipped:
 *  forEachAlive is what prunes unmounted chunks and fires their onRemove. */
export const useDressingColliders = <T extends ChunkWithPoints>(
  registry: { forEachAlive: (cb: (entry: T) => void) => void },
  options: { colliderDistance?: number; scanIntervalFrames?: number } = {},
): DressingColliderPoint[] => {
  const { colliderDistance = DRESSING_COLLIDER_DISTANCE, scanIntervalFrames = 10 } = options;
  const [colliders, setColliders] = React.useState<DressingColliderPoint[]>([]);
  const frameCount = useRef(0);
  const aliveScratch = useRef<T[]>([]);
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

    const near: DressingColliderPoint[] = [];
    let hash = 0;
    const maxDistSq = colliderDistance * colliderDistance;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          near.push({ key: `${p.x}_${p.z}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch ?? 0, parts: p.parts, mesh: p.mesh });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
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

export type { DressingBounds } from "./types";

interface DressingChunk {
  object: THREE.Object3D | null;
  dropped: boolean;
  taskId: string | null;
  centerX: number;
  centerZ: number;
}

/** Instance buffers only — shared geometries/materials belong to the feature component. */
const disposeChunkObject = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    // A per-chunk merged mesh (the bridge ribbons) marks itself the owner of its geometry.
    else if ((o as THREE.Mesh).isMesh && o.userData.ownsGeometry) (o as THREE.Mesh).geometry.dispose();
  });
};

/** Camera-following chunk lifecycle; render the returned ref as `<group ref={groupRef} />`. */
export const useDressingChunks = ({
  renderDistance,
  build,
}: {
  renderDistance: number;
  /** null = empty chunk. Must be deterministic per bounds. */
  build: (bounds: DressingBounds) => Promise<THREE.Object3D | null>;
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const chunks = useRef(new Map<string, DressingChunk>()).current;
  // Random phase so the feature components don't all scan on the same frame.
  const frameCount = useRef(Math.floor(Math.random() * UPDATE_INTERVAL_FRAMES));
  const buildRef = useRef(build);
  buildRef.current = build;

  useEffect(() => {
    const group = groupRef.current;
    return () => {
      chunks.forEach((chunk) => {
        chunk.dropped = true;
        if (chunk.taskId !== null) dressingQueue.removeTask(chunk.taskId);
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

    // Enqueued nearest-first: the shared queue serializes all features, and raw scan
    // order built a fresh ring's far corner before the ground under the camera.
    const candidates: { cx: number; cz: number; centerX: number; centerZ: number; distSq: number }[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const centerX = (cx + 0.5) * DRESSING_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * DRESSING_CHUNK_SIZE;
        const distSq = (camX - centerX) ** 2 + (camZ - centerZ) ** 2;
        if (distSq > renderDistance * renderDistance) continue;
        if (chunks.has(`${cx}_${cz}`)) continue;
        candidates.push({ cx, cz, centerX, centerZ, distSq });
      }
    }
    candidates.sort((a, b) => a.distSq - b.distSq);
    for (const { cx, cz, centerX, centerZ } of candidates) {
      const entry: DressingChunk = { object: null, dropped: false, taskId: null, centerX, centerZ };
      chunks.set(`${cx}_${cz}`, entry);

      entry.taskId = dressingQueue.addTask(async () => {
        entry.taskId = null;
        if (entry.dropped) return;
        const object = await buildRef.current({
          minX: cx * DRESSING_CHUNK_SIZE,
          minZ: cz * DRESSING_CHUNK_SIZE,
          maxX: (cx + 1) * DRESSING_CHUNK_SIZE,
          maxZ: (cz + 1) * DRESSING_CHUNK_SIZE,
        });
        if (!object) return;
        if (entry.dropped || !groupRef.current) {
          disposeChunkObject(object);
          return;
        }
        groupRef.current.add(object);
        entry.object = object;
      }, { at: { x: centerX, z: centerZ } });
    }

    // 1.3× hysteresis so chunk borders don't thrash.
    const dropDistSq = renderDistance * 1.3 * (renderDistance * 1.3);
    chunks.forEach((entry, key) => {
      const ddx = camX - entry.centerX;
      const ddz = camZ - entry.centerZ;
      if (ddx * ddx + ddz * ddz > dropDistSq) {
        entry.dropped = true;
        if (entry.taskId !== null) dressingQueue.removeTask(entry.taskId);
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
