import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DRESSING_COLLIDER_DISTANCE, DressingPartColliders, useDressingColliders } from "./dressingColliders";
import { DRESSING_CHUNK_SIZE, type DressingBounds, type DressingColliderBody, type DressingColliderSpec } from "./types";
import { TaskQueue } from "../../utils/task-queue/TaskQueue";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { freezeStaticSubtree } from "../../utils/utils";
import { instancedTemplate, reportUnwarmedPrograms, warmPrograms } from "../../utils/warmPrograms";
import { _curvature } from "../../vfx/curvature";
import { _spawnFade } from "../../vfx/spawnFade";
import { DressingAttributes } from "../types";
import { createDefaultsGroup } from "../utils";
import { enumerateDressing } from "./dressingWorker";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";

/**
 * THE DRESSING BASE (CLAUDE.md → "The three game-object classes"): a feature
 * component holds only its own placement query, geometry/materials and optional
 * animation; everything shared — chunk lifecycle, asset prep (curvature, spawn fade),
 * instanced assembly + rebase, chunk side-state, distance-gated colliders (their Rapier
 * bodies in dressingColliders.tsx) — lives here so a new feature cannot miss a world-wide effect.
 *
 * A feature uses: useDressingAssets (its geometry/materials) + useDressingChunks (a
 * placement-only feature) or useSolidDressing (a feature with a DressingColliderSpec),
 * and instancedFromPoints to assemble each chunk.
 */

const UPDATE_INTERVAL_FRAMES = 31;

// One budgeted queue across ALL dressing features so a ring of fresh chunks
// can't stack mesh assembly into one frame.
// Weight 1.5: at equal distance a building or the ground comes first; beyond 400u a chunk is background.
const dressingQueue = new TaskQueue({ weight: 1.5 });

type DressingDefaults = Pick<DressingAttributes, "renderDistance" | "colliderDistance" | "serverSynced">;

/** A solid feature's mount props: its distances only — its placement lives in its spec, the only one the
 *  server knows. Unset = the <Dressing> group's, then the feature's default. */
export type SolidDressingProps = Pick<DressingAttributes, "renderDistance" | "colliderDistance">;

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
  _spawnFade.patchMaterial(material);
};

const isMaterial = (asset: unknown): asset is THREE.Material => !!(asset as THREE.Material | undefined)?.isMaterial;

/** `warm`: the objects this feature draws, as program templates (utils/warmPrograms.ts) — linked at
 *  domain load, not when the first chunk streams in. Default: one InstancedMesh per material (what
 *  instancedFromPoints draws); a feature drawing anything else (a plain Mesh, instanceColor) lists its own. */
export const useDressingAssets = <T extends Record<string, { dispose: () => void }>>(
  create: () => T,
  warm?: (assets: T) => THREE.Object3D[]
): T => {
  const scene = useThree((state) => state.scene);
  const assets = useMemo(() => {
    const created = create();
    for (const asset of Object.values(created)) if (isMaterial(asset)) prepareDressingMaterial(asset);
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

export { yawFromDir } from "./types";

interface InstancePlacement {
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

interface ChunkRegistryEntry {
  /** parent === null once the chunk lifecycle unmounts it — the prune signal. */
  group: THREE.Object3D;
}

/** Per-chunk side-state pruned lazily from the feature's own frame loop (forEachAlive) and
 *  flushed on unmount — without the unmount flush, external registrations (lamp heads in
 *  the glow grid) leaked as phantom lights across domain switches / HMR. */
const useChunkRegistry = <T extends ChunkRegistryEntry>(onRemove?: (entry: T) => void) => {
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

/** `points` are the chunk's collider bodies — its spec's `bodiesOf`, so the server builds the same. */
export interface ChunkWithPoints extends ChunkRegistryEntry {
  points: DressingColliderBody[];
}

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

/** Chunks are dropped this far past the render distance, so chunk borders don't thrash. */
const DROP_HYSTERESIS = 1.3;

const chunkKeyOf = (cx: number, cz: number): string => `${cx}_${cz}`;

const chunkBoundsOf = (cx: number, cz: number): DressingBounds => ({
  minX: cx * DRESSING_CHUNK_SIZE,
  minZ: cz * DRESSING_CHUNK_SIZE,
  maxX: (cx + 1) * DRESSING_CHUNK_SIZE,
  maxZ: (cz + 1) * DRESSING_CHUNK_SIZE,
});

/** Cancels a chunk's queued build and unmounts and disposes what it drew. */
const discardChunk = (chunk: DressingChunk, group: THREE.Group | null, fades: _spawnFade.SpawnFadeSet): void => {
  chunk.dropped = true;
  if (chunk.taskId !== null) dressingQueue.removeTask(chunk.taskId);
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
  // Per CHUNK: a chunk's instances appear together, and the chunk is the unit that pops.
  const fades = useRef(new _spawnFade.SpawnFadeSet()).current;
  // Random phase so the feature components don't all scan on the same frame.
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
    const radius = Math.ceil(renderDistance / DRESSING_CHUNK_SIZE);
    const ccx = Math.floor(camX / DRESSING_CHUNK_SIZE);
    const ccz = Math.floor(camZ / DRESSING_CHUNK_SIZE);
    const candidates: ChunkCandidate[] = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const cx = ccx + dx;
        const cz = ccz + dz;
        const centerX = (cx + 0.5) * DRESSING_CHUNK_SIZE;
        const centerZ = (cz + 0.5) * DRESSING_CHUNK_SIZE;
        const distSq = (camX - centerX) ** 2 + (camZ - centerZ) ** 2;
        if (distSq > renderDistance * renderDistance) continue;
        if (chunks.has(chunkKeyOf(cx, cz))) continue;
        candidates.push({ cx, cz, centerX, centerZ, distSq });
      }
    }
    return candidates.sort((a, b) => a.distSq - b.distSq);
  };

  const queueChunk = ({ cx, cz, centerX, centerZ }: ChunkCandidate): void => {
    const entry: DressingChunk = { object: null, dropped: false, taskId: null, centerX, centerZ };
    chunks.set(chunkKeyOf(cx, cz), entry);
    entry.taskId = dressingQueue.addTask(async () => {
      entry.taskId = null;
      if (entry.dropped) return;
      const object = await buildRef.current(chunkBoundsOf(cx, cz));
      if (!object) return;
      if (entry.dropped || !groupRef.current) {
        disposeChunkObject(object);
        return;
      }
      reportUnwarmedPrograms(object, "a dressing chunk", "list it in the feature's useDressingAssets(create, warm) templates.");
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

/**
 * A SOLID dressing feature — one with a DressingColliderSpec (listed in catalog.ts, so the server builds
 * the same colliders): the chunk lifecycle, the spec's enumerator run with the spec's placement, the
 * spec's bodies per chunk and the distance-gated colliders, wired once. The placement is the spec's
 * ONLY: the server never sees a mount, so a solid feature takes no placement props (change the spec).
 * `build` turns a chunk's points (and the bodies `spec.bodiesOf` places for them — the drawn yaw must
 * be the body's) into what the chunk draws plus any per-chunk side state, which `onRemove` releases
 * when the chunk unmounts. Render the returned `content`; drive per-chunk animation from
 * `registry.forEachAlive` in your own useFrame.
 */
export const useSolidDressing = <K extends DressingEnumeratorName, T extends ChunkWithPoints = ChunkWithPoints>(
  spec: DressingColliderSpec<K>,
  options: {
    /** This client's request only, on top of the placement — must not move any point (e.g. power lines' `withNext`). */
    requestExtras?: Partial<EnumeratorArgs<K>>;
    /** The mount's own values; unset = the <Dressing> group's, then the default. */
    renderDistance: number | undefined;
    defaultRenderDistance: number;
    colliderDistance: number | undefined;
    /** Default DRESSING_COLLIDER_DISTANCE. */
    defaultColliderDistance?: number;
    onRemove?: (chunk: T) => void;
    build: (points: EnumeratorPoint<K>[], bodies: DressingColliderBody[], bounds: DressingBounds) => Omit<T, "points">;
  },
) => {
  const renderDistance = useDressingDefault("renderDistance", options.renderDistance, options.defaultRenderDistance);
  const colliderDistance = useDressingDefault(
    "colliderDistance",
    options.colliderDistance,
    options.defaultColliderDistance ?? DRESSING_COLLIDER_DISTANCE,
  );
  const registry = useChunkRegistry<T>(options.onRemove);
  const buildChunk = options.build;
  const request = options.requestExtras ? { ...spec.placement, ...options.requestExtras } : spec.placement;

  const groupRef = useDressingChunks({
    renderDistance,
    build: async (bounds) => {
      const points = await enumerateDressing(spec.enumerator, bounds, request);
      if (points.length === 0) return null;
      const bodies = points.flatMap(spec.bodiesOf);
      const chunk = buildChunk(points, bodies, bounds) as T;
      chunk.points = bodies;
      registry.add(chunk);
      return chunk.group;
    },
  });

  const colliders = useDressingColliders(registry, { colliderDistance });

  const content = (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the bodies near the player. */}
      <DressingPartColliders colliders={colliders} parts={spec.colliderParts} />
    </>
  );
  return { registry, content };
};
