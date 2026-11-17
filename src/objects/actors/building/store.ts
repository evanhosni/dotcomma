import * as THREE from "three";
import { makeDoorGeometry } from "../../doors/geometry";
import { buildExteriorGeometry } from "./exterior/geometry";
import { generateBuildingPlan } from ".";
import { addInteriorSlabsAndRamps, addInteriorWalls, buildInteriorColliders, mergeInteriorParts, shadeInteriorAndAddLights } from "./interior/geometry";
import { buildProxyHullVertices } from "./collider";
import { BuildingAttributes, BuildingPlan } from "./types";
import type { BuildingCacheEntry, ProceduralBuildingAssets, FarDoor, FarDoorSpec } from "./types";
import { MAX_IDLE_CACHE, INITIAL_CAPACITY, REBASE_DISTANCE } from "./constants";
import { prepareActorMaterial } from "../material";

// BuildingPlan → geometry and colliders, cached per (seed, options) and refcounted.

const cache = new Map<string, BuildingCacheEntry>();
const cacheKeyOf = (seed: string, optionsKey: string): string => `${seed}|${optionsKey}`;
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

  // One leaf per building (every door of a plan shares the first door's size).
  const { geometry: doorGeometry, leaf: doorLeaf } = makeDoorGeometry(plan.doors[0].width, plan.doors[0].height, plan.doorColor, plan.doorHandle);

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

/**
 * The door leaves of every building beyond its live distance, as ONE InstancedMesh (one draw call
 * for all of them — a mesh per leaf would be one lit draw per door out to 625u); inside the live
 * distance Building.tsx draws the real, clickable leaves.
 *
 * Instances are placed relative to a rebase origin near the camera (the mesh's position), so the GPU
 * never sees an absolute world coordinate (CLAUDE.md → Coordinate Precision).
 */

const box = new THREE.BoxGeometry(1, 1, 1);
const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.05 });
// No lamp glow: its patch reads modelMatrix only, so every instance would sample the mesh origin's glow.
// Per-instance spawn fade: the doors of every building share this one mesh, each fading with its own.
prepareActorMaterial(material, { skipQuantization: true, skipLampGlow: true, perInstanceSpawnFade: true });

let mesh: THREE.InstancedMesh | null = null;
let fadeAttribute: THREE.InstancedBufferAttribute | null = null;
let capacity = 0;
const doors: FarDoor[] = [];
let originX = 0;
let originZ = 0;

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _color = new THREE.Color();

const writeMatrix = (door: FarDoor): void => {
  _m.makeTranslation(door.x - originX, door.y, door.z - originZ);
  _m.multiply(_t.makeRotationY(door.yaw));
  _m.multiply(_t.makeTranslation(-door.width / 2, 0, 0));
  _m.multiply(_t.makeRotationY(door.angle));
  _m.multiply(_t.makeTranslation(door.leafCenter[0], door.leafCenter[1], door.leafCenter[2]));
  _m.multiply(_t.makeScale(door.leafSize[0], door.leafSize[1], door.leafSize[2]));
  mesh!.setMatrixAt(door.index, _m);
  mesh!.instanceMatrix.needsUpdate = true;
};

const writeFade = (door: FarDoor): void => {
  fadeAttribute!.setX(door.index, door.fade);
  fadeAttribute!.needsUpdate = true;
};

const writeColor = (door: FarDoor): void => {
  mesh!.setColorAt(door.index, _color.set(door.color));
  mesh!.instanceColor!.needsUpdate = true;
};

const writeDoor = (door: FarDoor): void => {
  writeMatrix(door);
  writeColor(door);
  writeFade(door);
};

const ensureCapacity = (scene: THREE.Scene, needed: number): void => {
  if (mesh && needed <= capacity) {
    if (!mesh.parent) scene.add(mesh);
    return;
  }
  const previous = mesh;
  capacity = Math.max(INITIAL_CAPACITY, capacity * 2);
  // Its own geometry (sharing the box's attributes) because the fade attribute is sized to the capacity.
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(box.getIndex());
  for (const name of Object.keys(box.attributes)) geometry.setAttribute(name, box.getAttribute(name));
  fadeAttribute = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  fadeAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aSpawnFade", fadeAttribute);
  mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, _color.set(0xffffff));
  // One draw for doors all over the world: culling bounds would have to span them all anyway.
  mesh.frustumCulled = false;
  mesh.position.set(originX, 0, originZ);
  mesh.count = doors.length;
  for (const door of doors) writeDoor(door);
  if (previous) {
    previous.removeFromParent();
    previous.dispose();
    // Detach the shared box attributes first: dispose() frees every attached buffer.
    const old = previous.geometry;
    for (const name of Object.keys(box.attributes)) old.deleteAttribute(name);
    old.setIndex(null);
    old.dispose();
  }
  scene.add(mesh);
};

export const addFarDoor = (scene: THREE.Scene, spec: FarDoorSpec, angle: number, fade = 1): FarDoor => {
  ensureCapacity(scene, doors.length + 1);
  const door: FarDoor = { ...spec, angle, fade, index: doors.length };
  doors.push(door);
  mesh!.count = doors.length;
  writeDoor(door);
  return door;
};

export const setFarDoorFade = (door: FarDoor, fade: number): void => {
  if (door.fade === fade || doors[door.index] !== door) return;
  door.fade = fade;
  writeFade(door);
};

export const setFarDoorAngle = (door: FarDoor, angle: number): void => {
  if (door.angle === angle || doors[door.index] !== door) return;
  door.angle = angle;
  writeMatrix(door);
};

/** Swap-remove: the last instance moves into the freed slot. */
export const removeFarDoor = (door: FarDoor): void => {
  if (doors[door.index] !== door) return;
  const last = doors.pop()!;
  if (last !== door) {
    last.index = door.index;
    doors[last.index] = last;
    writeDoor(last);
  }
  mesh!.count = doors.length;
};

/** Re-anchors the instances near the camera once it has moved REBASE_DISTANCE; cheap to call every frame. */
export const followFarDoorOrigin = (cameraX: number, cameraZ: number): void => {
  if (!mesh) return;
  const dx = cameraX - originX;
  const dz = cameraZ - originZ;
  if (dx * dx + dz * dz < REBASE_DISTANCE * REBASE_DISTANCE) return;
  originX = Math.round(cameraX);
  originZ = Math.round(cameraZ);
  mesh.position.set(originX, 0, originZ);
  for (const door of doors) writeMatrix(door);
};

/** A program template of the shared mesh (instanceColor + the per-instance fade) — utils/render/index.ts. */
export const farDoorWarmTemplate = (): THREE.InstancedMesh => {
  const template = new THREE.InstancedMesh(box, material, 1);
  template.setColorAt(0, _color.set(0xffffff));
  return template;
};
