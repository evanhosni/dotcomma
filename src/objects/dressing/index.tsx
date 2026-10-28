import * as THREE from "three";
import { ChunkColliders, useChunkColliders } from "../../world/chunks/colliders";
import { useChunkRegistry, useWorldChunks, type ChunkWithPoints } from "../../world/chunks";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { traceEvent } from "../../utils/spikeTrace";
import { DressingAttributes } from "../types";
import { enumerateDressing } from "./worker";
import type { DressingEnumeratorName, EnumeratorArgs, EnumeratorPoint } from "./enumerators";
import type { ChunkBounds, ColliderBody, DressingColliderSpec } from "./types";

/**
 * THE DRESSING BASE (CLAUDE.md → "The three game-object classes"): mass, identical, stateless
 * scenery as one InstancedMesh per chunk. A feature holds only its own placement query,
 * geometry/materials and optional animation; the INSTANCED assembly and the collider wiring are
 * here, and the chunk lifecycle itself is the world's (world/chunks/), shared with the tunnels.
 *
 * A feature uses: useChunkAssets (its geometry/materials) + useWorldChunks (a placement-only
 * feature) or useSolidDressing (a feature with a DressingColliderSpec), and instancedFromPoints
 * to assemble each chunk.
 */

/** A solid feature's mount props: its view distances only — its placement lives in its spec, the
 *  only one the server knows. Unset = the feature's own default. */
export type SolidDressingProps = Pick<DressingAttributes, "renderDistance" | "colliderDistance">;

// The chunk lifecycle, assets and registry are the WORLD's; re-exported so a feature has one import.
export { prepareChunkMaterial, selfPatchedMaterial, useChunkAssets, useChunkRegistry, useWorldChunks } from "../../world/chunks";
export type { ChunkWithPoints, SelfPatchedMaterial } from "../../world/chunks";
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
  const t0 = performance.now();
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
  traceEvent("dressing:finalize", performance.now() - t0);
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

/**
 * A SOLID dressing feature — one with a DressingColliderSpec (listed in catalog.ts, so the server builds
 * the same colliders): the chunk lifecycle, the spec's enumerator run with the spec's placement, the
 * spec's bodies per chunk and the distance-gated colliders, wired once. The placement is the spec's
 * ONLY: the server never sees a mount, so a solid feature takes no placement props (change the spec).
 * `build` turns a chunk's points (and the bodies `spec.bodiesOf` places for them — the drawn yaw must
 * be the body's) into what the chunk draws plus any per-chunk side state, which `onRemove` releases
 * when the chunk unmounts. Render the returned `content`; drive per-chunk animation from
 * `registry.forEachAlive` in your own useFrame.
 */export const useSolidDressing = <K extends DressingEnumeratorName, T extends ChunkWithPoints = ChunkWithPoints>(
  spec: DressingColliderSpec<K>,
  options: {
    /** This client's request only, on top of the placement — must not move any point (e.g. power lines' `withNext`). */
    requestExtras?: Partial<EnumeratorArgs<K>>;
    /** Already resolved across the kind's mounts (objects/dressing/utils.ts `farthest`). */
    renderDistance: number;
    colliderDistance: number;
    onRemove?: (chunk: T) => void;
    build: (points: EnumeratorPoint<K>[], bodies: ColliderBody[], bounds: ChunkBounds) => Omit<T, "points">;
  },
) => {
  const { renderDistance, colliderDistance } = options;
  const registry = useChunkRegistry<T>(options.onRemove);
  const buildChunk = options.build;
  const request = options.requestExtras ? { ...spec.placement, ...options.requestExtras } : spec.placement;

  const groupRef = useWorldChunks({
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

  const colliders = useChunkColliders(registry, { colliderDistance });

  const content = (
    <>
      <group ref={groupRef} />
      {/* Real colliders only for the bodies near the player. */}
      <ChunkColliders colliders={colliders} parts={spec.colliderParts} />
    </>
  );
  return { registry, content };
};

