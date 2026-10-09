import * as THREE from "three";
import { bakeVertexColor, mergeOrThrow, type Vec3 } from "./buildingGeometry";
import { buildExteriorGeometry } from "./exteriorGeometry";
import { generateBuildingPlan } from "./generatePlan";
import {
  addInteriorSlabsAndRamps,
  addInteriorWalls,
  buildInteriorColliders,
  mergeInteriorParts,
  shadeInteriorAndAddLights,
  type RampCollider,
} from "./interiorGeometry";
import { buildProxyHullVertices } from "./proxyCollider";
import { BuildingAttributes, BuildingPlan, WallBox } from "./types";

// BuildingPlan → geometry and colliders, cached per (seed, options) and refcounted.

export interface DoorPlacement {
  position: Vec3;
  /** +z faces out of the building. */
  yaw: number;
  width: number;
  height: number;
}

export interface ProceduralBuildingAssets {
  plan: BuildingPlan;
  exteriorGeometry: THREE.BufferGeometry;
  /** Body triangles only (windows excluded), so door openings are walkable. */
  exteriorVertices: Float32Array;
  exteriorIndices: Uint32Array;
  /** Wall/pillar cuboids; slabs are the trimesh below. (The interior MESH is not here: it is built
   *  only for buildings the player walks up to — beginBuildingInteriorBuild.) */
  interiorColliders: WallBox[];
  rampColliders: RampCollider[];
  interiorSlabVertices: Float32Array;
  interiorSlabIndices: Uint32Array;
  /** Origin = hinge edge, leaf extends +x, so rotating the parent group swings it. */
  doorGeometry: THREE.BufferGeometry;
  /** The same leaf as a box (hinge-relative center + size + color) for the far-door instances. */
  doorLeaf: { center: Vec3; size: Vec3; color: number };
  doors: DoorPlacement[];
  /** Plain typed array — nothing to dispose (see proxyCollider.ts). */
  proxyHullVertices: Float32Array;
}

// REFCOUNTED: the city mounts 300-600 buildings, and an eviction that ignored
// mounts would dispose geometry still on live meshes.
interface BuildingCacheEntry {
  assets: ProceduralBuildingAssets;
  /** Walls, slabs, ramps and ceiling lights as ONE vertex-colored geometry; null until someone needs it.
   *  Lives exactly while the building is mounted: disposed when the refcount drops to 0. */
  interior: THREE.BufferGeometry | null;
  refCount: number;
  /** Monotonic tick of the last drop to refcount 0 — eviction order. */
  releasedAt: number;
}

const cache = new Map<string, BuildingCacheEntry>();
const cacheKeyOf = (seed: string, optionsKey: string): string => `${seed}|${optionsKey}`;
/** Caps IDLE (refcount 0) entries only; retained entries never count. */
const MAX_IDLE_CACHE = 128;
let releaseTick = 0;

export const peekProceduralBuildingAssets = (seed: string, optionsKey: string): ProceduralBuildingAssets | null =>
  cache.get(cacheKeyOf(seed, optionsKey))?.assets ?? null;

const disposeEntry = (e: BuildingCacheEntry): void => {
  e.assets.exteriorGeometry.dispose();
  e.assets.doorGeometry.dispose();
  e.interior?.dispose();
  e.interior = null;
};

const trimIdleEntries = (): void => {
  let idle = 0;
  for (const e of cache.values()) if (e.refCount === 0) idle++;
  while (idle > MAX_IDLE_CACHE) {
    let oldestKey: string | null = null;
    let oldestTick = Infinity;
    for (const [k, e] of cache) {
      if (e.refCount === 0 && e.releasedAt < oldestTick) {
        oldestTick = e.releasedAt;
        oldestKey = k;
      }
    }
    if (oldestKey === null) break;
    disposeEntry(cache.get(oldestKey)!);
    cache.delete(oldestKey);
    idle--;
  }
};

/** `assets` closes the render→effect race: a concurrent release can trim the
 *  just-peeked idle entry first, and a disposed BufferGeometry re-uploads on
 *  its next draw, so re-registering it is safe. */
export const retainProceduralBuildingAssets = (seed: string, optionsKey: string, assets: ProceduralBuildingAssets): void => {
  const key = cacheKeyOf(seed, optionsKey);
  const entry = cache.get(key);
  if (entry) {
    entry.refCount++;
  } else {
    cache.set(key, { assets, interior: null, refCount: 1, releasedAt: releaseTick++ });
  }
};

export const releaseProceduralBuildingAssets = (seed: string, optionsKey: string): void => {
  const entry = cache.get(cacheKeyOf(seed, optionsKey));
  if (!entry || entry.refCount === 0) return;
  entry.refCount--;
  if (entry.refCount === 0) {
    entry.interior?.dispose();
    entry.interior = null;
    entry.releasedAt = releaseTick++;
    trimIdleEntries();
  }
};

export const peekBuildingInterior = (seed: string, optionsKey: string): THREE.BufferGeometry | null =>
  cache.get(cacheKeyOf(seed, optionsKey))?.interior ?? null;

/** The interior mesh of a RETAINED building in phases (walls → slabs and ramps → shading and panels → merge) for the build queue to
 *  yield between, like the exterior's: as one task it was the longest single task of a city walk.
 *  finish() stores it on the cache entry and returns it — the entry's own when another build got there
 *  first, null when the building was released meanwhile. */
export const beginBuildingInteriorBuild = (
  seed: string,
  optionsKey: string,
  plan: BuildingPlan,
): { steps: Array<() => void>; finish: () => THREE.BufferGeometry | null } => {
  const parts: THREE.BufferGeometry[] = [];
  return {
    steps: [
      () => addInteriorWalls(plan, parts),
      () => addInteriorSlabsAndRamps(plan, parts),
      () => shadeInteriorAndAddLights(plan, parts),
    ],
    finish: () => {
      const entry = cache.get(cacheKeyOf(seed, optionsKey));
      if (!entry || entry.refCount === 0 || entry.interior) {
        parts.forEach((g) => g.dispose());
        return entry && entry.refCount > 0 ? entry.interior : null;
      }
      entry.interior = mergeInteriorParts(parts);
      return entry.interior;
    },
  };
};

/** Split into phases (plan → exterior → interior colliders → assembly) so the build
 *  queue can yield between them; finish() dedupes against the cache, so a
 *  same-seed build that lost a race adopts the winner. */
export const beginProceduralBuildingBuild = (
  seed: string,
  opts: BuildingAttributes,
  optionsKey: string = JSON.stringify(opts),
): { steps: Array<() => void>; finish: () => ProceduralBuildingAssets } => {
  let plan: ReturnType<typeof generateBuildingPlan>;
  let ext: ReturnType<typeof buildExteriorGeometry>;
  let interior: ReturnType<typeof buildInteriorColliders>;
  return {
    steps: [
      () => {
        plan = generateBuildingPlan(seed, opts);
      },
      () => {
        ext = buildExteriorGeometry(plan);
      },
      () => {
        interior = buildInteriorColliders(plan);
      },
    ],
    finish: () => {
      const key = cacheKeyOf(seed, optionsKey);
      const existing = cache.get(key);
      if (existing) return existing.assets;
      return assembleBuildingAssets(key, plan, ext, interior);
    },
  };
};

/** The handle on both faces of the leaf, near its free edge at about a third of the door's height: a
 *  spindle through the leaf, then a knob, or a lever pointing back at the hinge. Near leaves only — the
 *  far-door instances are bare boxes. */
const doorHandleParts = (plan: BuildingPlan, leaf: ProceduralBuildingAssets["doorLeaf"]): THREE.BufferGeometry[] => {
  const { lever, color } = plan.doorHandle;
  const doorHeight = plan.doors[0].height;
  const x = leaf.center[0] + leaf.size[0] / 2 - 0.4;
  const y = -doorHeight / 2 + doorHeight * 0.33;
  const face = leaf.size[2] / 2;
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(0.04, 0.04, leaf.size[2] + 0.36, 8).rotateX(Math.PI / 2).translate(x, y, 0)];
  for (const side of [1, -1]) {
    const z = side * (face + 0.16);
    parts.push(
      lever
        ? new THREE.BoxGeometry(0.42, 0.07, 0.08).translate(x - 0.17, y, z)
        : new THREE.SphereGeometry(0.11, 10, 8).translate(x, y, z),
    );
  }
  return parts.map((g) => bakeVertexColor(g.toNonIndexed(), color));
};

const assembleBuildingAssets = (
  key: string,
  plan: ReturnType<typeof generateBuildingPlan>,
  extBuild: ReturnType<typeof buildExteriorGeometry>,
  interiorBuild: ReturnType<typeof buildInteriorColliders>,
): ProceduralBuildingAssets => {
  const { geometry: exteriorGeometry, bodyPositionFloatCount } = extBuild;

  // Outer body triangles + inner shell surface: the wall face is solid from either side.
  const allVerts = (exteriorGeometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  const exteriorVertices = new Float32Array(bodyPositionFloatCount + interiorBuild.innerShellVertices.length);
  exteriorVertices.set(allVerts.subarray(0, bodyPositionFloatCount));
  exteriorVertices.set(interiorBuild.innerShellVertices, bodyPositionFloatCount);
  const exteriorIndices = new Uint32Array(exteriorVertices.length / 3);
  for (let i = 0; i < exteriorIndices.length; i++) exteriorIndices[i] = i;

  // The leaf overlaps the jamb and header so a closed door never shows a gap.
  const leafW = plan.doors[0].width + 0.16;
  const doorLeaf = { center: [leafW / 2 - 0.08, 0.05, 0] as Vec3, size: [leafW, plan.doors[0].height + 0.2, 0.1] as Vec3, color: plan.doorColor };
  const doorGeometry = mergeOrThrow(
    [
      bakeVertexColor(new THREE.BoxGeometry(...doorLeaf.size).translate(...doorLeaf.center).toNonIndexed(), plan.doorColor),
      ...doorHandleParts(plan, doorLeaf),
    ],
    "door leaf",
  );

  const assets: ProceduralBuildingAssets = {
    plan,
    exteriorGeometry,
    exteriorVertices,
    exteriorIndices,
    interiorColliders: interiorBuild.interiorColliders,
    rampColliders: interiorBuild.rampColliders,
    interiorSlabVertices: interiorBuild.interiorSlabVertices,
    interiorSlabIndices: interiorBuild.interiorSlabIndices,
    doorGeometry,
    doorLeaf,
    doors: plan.doors.map((d) => ({
      position: d.position,
      yaw: d.yaw,
      width: d.width,
      height: d.height,
    })),
    proxyHullVertices: buildProxyHullVertices(plan),
  };

  // Refcount 0 until the mounting <Building>'s retain effect pins it.
  cache.set(key, { assets, interior: null, refCount: 0, releasedAt: releaseTick++ });
  trimIdleEntries();
  return assets;
};
