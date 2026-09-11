import { useFrame } from "@react-three/fiber";
import { CuboidCollider, RigidBody } from "@react-three/rapier";
import React, { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DRESSING_CHUNK_SIZE, type DressingColliderPart } from "./types";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { _curvature } from "../../vfx/curvature";
import { DressingAttributes } from "../types";
import { createDefaultsGroup } from "../utils";

/**
 * DRESSING — the instanced class of the game-object hierarchy (see
 * objects/types.ts for the class overview and the shared base attributes).
 *
 * Dressing is mass, stateless, identical scenery (street lamps, road
 * markers, traffic lights, power lines): no per-object React
 * components, no per-object state. Placement is enumerated OFF-THREAD in
 * utils/workers/dressing.worker.ts (via dressingWorker.ts) and rendered
 * as one InstancedMesh (or a few) per chunk. Objects with their own identity,
 * state, or interaction are ACTORS (objects/actors/); mass GPU vegetation at
 * thousands-per-chunk scale is FOLIAGE (objects/foliage/Foliage.tsx) — it
 * deliberately does not build on this chunk base.
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

export { DRESSING_CHUNK_SIZE } from "./types";
const UPDATE_INTERVAL_FRAMES = 31;

// ONE shared budgeted queue across all dressing features: the worker does the
// heavy enumeration; this only serializes requests and yields between mesh
// builds so a ring of fresh chunks can't stack assembly work into one frame.
const dressingQueue = new TaskQueue();

// ── <Dressing> group ──

/** Shared defaults for a biome's dressing features (base game-object
 *  attributes; features fall back to their own defaults when neither prop
 *  nor group sets one). */
/** The DressingAttributes a <Dressing> group can default for its children —
 *  the ones every feature resolves through useDressingDefault. */
export type DressingDefaults = Pick<DressingAttributes, "renderDistance" | "colliderDistance">;

/**
 * Groups a biome's dressing features, mirroring <Actors>/<Foliage>: props set
 * here act as shared defaults for the children — a child's own props always
 * win (shared group pattern: objects/utils.tsx).
 *
 *   <Dressing renderDistance={400}>
 *     <StreetLamps />
 *     <RoadMarkers />
 *   </Dressing>
 */
const DressingGroup = createDefaultsGroup<DressingDefaults>();
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

// ── Shared assets ──

/**
 * ALL shared material logic for the dressing class. A feature creates its
 * materials however it likes; every one of them passes through here, so a new
 * dressing feature cannot forget a world-wide effect (and none of them has to
 * know one exists).
 *
 *  - WORLD CURVATURE (vfx/curvature.ts): instanced scenery sinks with the
 *    ground it stands on. Without it, lamps and markers float over a curved
 *    horizon.
 *
 * Quantization is deliberately NOT applied: dressing renders instanced, and
 * the quantization patch's instanced branch works in absolute space (see
 * utils/quantization) — no instanced material is quantized today.
 */
export const prepareDressingMaterial = (material: THREE.Material): void => {
  _curvature.patchMaterial(material);
};

/** Create geometries/materials once, prepare every material through
 *  prepareDressingMaterial, and dispose them all on unmount. */
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

// ── Instancing helpers ──

// The collider-part type and the yaw helper live in ./types (Three-free) so
// the SERVER can build the same collider boxes; re-exported for the features.
export { yawFromDir } from "./types";
export type { DressingColliderPart } from "./types";

export interface InstancePlacement {
  x: number;
  y: number;
  z: number;
  yaw?: number;
}

/**
 * Standard chunk assembly: one InstancedMesh from a point list. `place` maps
 * each point to a position + yaw (local +X faces along yaw). Frustum culling
 * stays ON: instanced bounds don't auto-fit scattered instances (three would
 * have to walk every matrix), but the placements are known right here, so an
 * explicit bounding sphere is computed from their min/max — padded by the
 * geometry's own bounds so tall poles / long arms survive any per-instance
 * yaw. Matrices are composed with ABSOLUTE positions and then REBASED to a
 * chunk-local origin by finalizeInstancedChunk (float32 far-from-origin —
 * see its doc).
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
    // A yaw rotation about the instance origin can swing the geometry's
    // sphere center anywhere on a circle of radius |center| — pad by both.
    finalizeInstancedChunk(mesh, minX, minY, minZ, maxX, maxY, maxZ, gbs.center.length() + gbs.radius);
  }
  return mesh;
};

/** Shared tail of every instanced-chunk build — far-from-origin REBASE +
 *  culling bounds + GPU warm-up.
 *
 *  Instance matrices arrive filled with ABSOLUTE world translations. Rendered
 *  that way (mesh at the world origin), the GPU multiplies a huge instance
 *  translation against the view matrix's huge opposite translation in
 *  float32 — the classic far-from-origin cancellation, and dressing visibly
 *  jittered past ~100k units (the exact failure mode the coordinate-precision
 *  rules exist for — see CLAUDE.md). So the mesh is parked AT the extents
 *  center and every instance translation is made RELATIVE to it: the
 *  chunk→camera translation then resolves on the CPU in float64
 *  (modelViewMatrix) and everything the GPU touches stays chunk-sized.
 *  Subtracting after the float32 compose leaves only a CONSTANT sub-ULP
 *  placement offset (~0.06u at 1M units — invisible), never per-frame jitter.
 *
 *  The explicit bounding sphere keeps frustum culling ON (instanced bounds
 *  don't auto-fit scattered instances); it is LOCAL to the mesh — three
 *  applies matrixWorld when culling. The warm draw pays the buffer upload at
 *  (budget-staggered) chunk build time, not when the player first turns
 *  toward the chunk. */
export const finalizeInstancedChunk = (
  mesh: THREE.InstancedMesh,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
  pad: number
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
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + pad
  );
  uploadOnFirstDraw(mesh);
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
 * feature's own useFrame; no extra frame loop is added. On component unmount
 * `onRemove` runs for every remaining entry: the lazy prune only fires from
 * the feature's frame loop, so without this, external registrations (lamp
 * heads in the lampGlow grid) would leak as phantom lights across world
 * switches / HMR.
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
  useEffect(() => {
    const registry = registryRef.current!;
    return () => {
      registry.entries.forEach((entry) => onRemoveRef.current?.(entry));
      registry.entries.clear();
    };
  }, []);
  return registryRef.current;
};

// ── Distance-gated colliders ──

/** A collider site: where one piece of dressing stands, and which way it faces.
 *  `yaw` is carried through from the placement point because a collider that
 *  isn't square in plan (a power-line crossarm) has to match the instance's
 *  rotation — the same yaw instancedFromPoints applied to the visual. */
export interface DressingColliderPoint {
  key: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Registry entry shape the collider scan needs: the chunk's placement points. */
export interface ChunkWithPoints extends ChunkRegistryEntry {
  points: { x: number; y: number; z: number; yaw?: number }[];
}

/** Default camera distance inside which a dressing feature mounts real
 *  colliders (see useDressingColliders). Thin street furniture only needs
 *  to be solid where the player can actually reach it. */
export const DRESSING_COLLIDER_DISTANCE = 90;


/**
 * Real colliders for the in-range pieces of a dressing feature: one fixed
 * body per point (carrying the instance's yaw so off-axis parts line up
 * with what's drawn) with a cuboid per part. Street lamps, traffic signals
 * and power poles all mount exactly this — it used to be three copies of the
 * same JSX.
 */
export const DressingPartColliders = ({
  colliders,
  parts,
}: {
  colliders: DressingColliderPoint[];
  parts: DressingColliderPart[];
}) => (
  <>
    {colliders.map((c) => (
      <RigidBody key={c.key} type="fixed" colliders={false} position={[c.x, c.y, c.z]} rotation={[0, c.yaw, 0]}>
        {parts.map((p, i) => (
          <CuboidCollider key={i} args={[p.w / 2, p.h / 2, p.d / 2]} position={[p.x, p.y, 0]} />
        ))}
      </RigidBody>
    ))}
  </>
);

/**
 * The handful of dressing pieces close enough to the camera to be worth a real
 * collider. Instanced scenery can't carry colliders per instance — thousands of
 * Rapier shapes would cost far more than the draw calls the instancing saved —
 * so each feature mounts real colliders ONLY within `distance` and lets the rest
 * be scenery you walk through at range (nothing is there to touch them).
 *
 * This lives in the base because it is identical for every feature that wants
 * it, and the cheap version of it is wrong in two ways worth stating:
 *   - the registry sweep must run EVERY interval even when the scan is skipped —
 *     `forEachAlive` is what prunes unmounted chunks and fires their `onRemove`
 *     (lamp heads leaving the glow grid);
 *   - change detection is NUMERIC (count + coordinate hash), not a joined key
 *     string, and the whole scan is skipped while the camera has barely moved
 *     and the alive chunk set is unchanged — nothing can have entered or left
 *     range, and this runs across every mounted chunk of the feature.
 *
 * Returns the in-range points; render one <RigidBody> per entry, keyed by `key`.
 */
export const useDressingColliders = <T extends ChunkWithPoints>(
  registry: { forEachAlive: (cb: (entry: T) => void) => void },
  options: { distance?: number; scanIntervalFrames?: number } = {},
): DressingColliderPoint[] => {
  const { distance = DRESSING_COLLIDER_DISTANCE, scanIntervalFrames = 10 } = options;
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
    const maxDistSq = distance * distance;
    for (const chunk of alive) {
      for (const p of chunk.points) {
        const dx = p.x - camera.position.x;
        const dz = p.z - camera.position.z;
        if (dx * dx + dz * dz < maxDistSq) {
          near.push({ key: `${p.x}_${p.z}`, x: p.x, y: p.y, z: p.z, yaw: p.yaw ?? 0 });
          hash += p.x * 31 + p.z * 17 + p.y;
        }
      }
    }
    alive.length = 0;
    // Coordinates are deterministic, so an equal count + hash means the same
    // set — no re-render unless something actually entered or left range.
    if (near.length !== last.colliderCount || hash !== last.colliderHash) {
      last.colliderCount = near.length;
      last.colliderHash = hash;
      setColliders(near);
    }
  });

  return colliders;
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
  // Domain-space chunk center, stored so the prune pass never parses it back
  // out of the map key.
  centerX: number;
  centerZ: number;
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

    // Build chunks entering range — collected first, then enqueued
    // nearest-first (the shared queue serializes ALL dressing features, so
    // raw scan order made a fresh ring build its far corner before the
    // ground under the camera).
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
      const entry: DressingChunk = { object: null, disposed: false, centerX, centerZ };
      chunks.set(`${cx}_${cz}`, entry);

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

    // Drop chunks leaving range (hysteresis so borders don't thrash)
    const dropDistSq = renderDistance * 1.3 * (renderDistance * 1.3);
    chunks.forEach((entry, key) => {
      const ddx = camX - entry.centerX;
      const ddz = camZ - entry.centerZ;
      if (ddx * ddx + ddz * ddz > dropDistSq) {
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
