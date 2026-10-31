import * as THREE from "three";
import { smoothstep } from "../../utils/math";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { instancedTemplate, meshTemplate } from "../../utils/warmPrograms";
import { COVER_RADIUS, COVER_THICKNESS, FRAME_INNER_RADIUS, FRAME_OUTER_RADIUS, FRAME_SAMPLES, FRAME_TOP_OVER_GROUND } from "../../utils/workers/underground/constants";
import { LADDER_FACE, tunnelColliderBodies } from "../../utils/workers/underground/colliderBodies";
import type { DiscPose, ManholeInfo, SewerDoor, TunnelEntrance, TunnelMesh, UndergroundChunk } from "../../utils/workers/underground/types";
import { ENTRANCE_FADE_UNIFORM } from "../shaders/terrainHoles";
import { createEntranceMaterial } from "../terrain/material";
import { makeDoorGeometry } from "../../objects/doors/door";
import type { DoorHandle } from "../../objects/doors/types";
import { bakeVertexColor, mergeOrThrow } from "../../utils/geometry";
import { type ChunkWithPoints, selfPatchedMaterial, type SelfPatchedMaterial } from "../chunks";
import { type ColliderBody, yawFromDir } from "../chunks/types";
import { createCaveRockMaterial, createIronMaterial, createLiquidMaterial, createSewerWallMaterial, createTunnelObjectMaterial } from "./material";
import { isOpen } from "./toggles";

/**
 * What a tunnel chunk DRAWS (and its collider bodies), built from an UndergroundChunk on the main
 * thread: the walls, the entrance patch, the liquid, each door with its
 * frame, each manhole's cover, frame ring and ladder. Everything is relative to the chunk's center
 * (the group's position); the chunk's collider bodies are the brick columns, a slab per ladder and a
 * slab per CLOSED door.
 */

const DOOR_FRAME_THICKNESS = 0.2;
const DOOR_FRAME_DEPTH = 0.12;
const DOOR_COLOR = 0x6d7682;
const DOOR_HANDLE: DoorHandle = { lever: true, color: 0xb9bcc2 };
const FRAME_COLOR = 0x4b525c;
const RUNG_COLOR = 0x8a8f96;
const RUNG_WIDTH = 0.7;
const RUNG_SPACING = 0.4;
const RUNG_FROM_FLOOR = 0.35;
const RUNG_TO_STREET = 0.3;
const RUNG_SIZE = 0.05;
/** The rungs stand just off the collider slab's face (colliderBodies.ts LADDER_FACE). */
const LADDER_OFFSET = LADDER_FACE + 0.03;
const FRAME_BELOW_GROUND = 0.05;
export const COVER_SLIDE_SECONDS = 0.8;
/** A sliding cover rises this much at the middle of its slide. */
const COVER_SLIDE_LIFT = 0.12;

/** A type (not an interface): the dressing base's asset hook takes a record of disposables. */
export type TunnelAssets = {
  caveRock: SelfPatchedMaterial;
  sewerWall: SelfPatchedMaterial;
  object: SelfPatchedMaterial;
  liquid: SelfPatchedMaterial;
  iron: THREE.MeshStandardMaterial;
  cover: THREE.BufferGeometry;
};

export const createTunnelAssets = (): TunnelAssets => ({
  caveRock: selfPatchedMaterial(createCaveRockMaterial()),
  sewerWall: selfPatchedMaterial(createSewerWallMaterial()),
  object: selfPatchedMaterial(createTunnelObjectMaterial()),
  liquid: selfPatchedMaterial(createLiquidMaterial()),
  iron: createIronMaterial(),
  cover: new THREE.CylinderGeometry(COVER_RADIUS, COVER_RADIUS, COVER_THICKNESS, 24).translate(0, COVER_THICKNESS / 2, 0),
});

/** The programs a chunk can draw, for the load-time warm-up. */
export const tunnelWarmTemplates = (a: TunnelAssets): THREE.Object3D[] => [
  meshTemplate(a.caveRock.material),
  meshTemplate(a.sewerWall.material),
  meshTemplate(a.object.material),
  meshTemplate(a.liquid.material),
  meshTemplate(a.iron),
  instancedTemplate(a.object.material, { instanceColor: true }),
];

export interface DoorRuntime {
  id: string;
  door: SewerDoor;
  hinge: THREE.Group;
  leaf: THREE.Mesh;
}

export interface CoverRuntime {
  id: string;
  entrance: TunnelEntrance;
  info: ManholeInfo;
  mesh: THREE.Mesh;
  /** 0 closed … 1 aside. */
  progress: number;
  target: number;
}

export interface TunnelChunkObject extends ChunkWithPoints {
  chunk: UndergroundChunk;
  group: THREE.Group;
  walls: THREE.Mesh | null;
  patch: THREE.Mesh | null;
  /** The sewers' border caps: each drawn while its neighbour chunk is not loaded (the frame loop). */
  caps: { neighbor: string; mesh: THREE.Mesh }[];
  doors: DoorRuntime[];
  /** The doors' hinges and open flags, in `doors` order: what the frame loop swings, without lists per frame. */
  doorHinges: THREE.Object3D[];
  doorsOpen: boolean[];
  covers: CoverRuntime[];
  /** The mouths whose footprint reaches this chunk. */
  mouthIds: string[];
  /** The entrance fade the walls and patch draw with (1 for a chunk with no mouth). */
  fade: number;
}

const entranceMaterials = new WeakMap<THREE.ShaderMaterial, THREE.ShaderMaterial>();
/** The ENTRANCE variant of the terrain material, one per base. */
export const entranceMaterialOf = (base: THREE.ShaderMaterial): THREE.ShaderMaterial => {
  let m = entranceMaterials.get(base);
  if (!m) {
    m = createEntranceMaterial(base);
    entranceMaterials.set(base, m);
  }
  return m;
};

const own = <T extends THREE.Mesh>(mesh: T): T => {
  mesh.userData.ownsGeometry = true;
  uploadOnFirstDraw(mesh);
  return mesh;
};

/** Writes the chunk's entrance fade into the material right before the draw (shared material, per mesh value). */
const syncEntranceFade =
  (obj: TunnelChunkObject) =>
  (_r: THREE.WebGLRenderer, _s: THREE.Scene, _c: THREE.Camera, _g: THREE.BufferGeometry, material: THREE.Material): void => {
    const u = (material as THREE.ShaderMaterial).uniforms?.[ENTRANCE_FADE_UNIFORM];
    if (!u || u.value === obj.fade) return;
    u.value = obj.fade;
    (material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
  };

const buildWalls = (chunk: UndergroundChunk, assets: TunnelAssets, obj: TunnelChunkObject): THREE.Mesh | null => {
  if (chunk.mesh.indices.length === 0) return null;
  // The sewers carry vertex colors; the cave rock's color is its material's formula.
  const mesh = own(new THREE.Mesh(tunnelGeometry(chunk.mesh), chunk.style === "cave" ? assets.caveRock.material : assets.sewerWall.material));
  if (chunk.style === "cave") mesh.onBeforeRender = syncEntranceFade(obj);
  return mesh;
};

const buildPatch = (chunk: UndergroundChunk, entranceMaterial: THREE.ShaderMaterial | null, obj: TunnelChunkObject): THREE.Mesh | null => {
  const p = chunk.patch;
  if (!p || !entranceMaterial || p.indices.length === 0) return null;
  const g = new THREE.BufferGeometry();
  const n = p.positions.length / 3;
  g.setAttribute("position", new THREE.BufferAttribute(p.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(p.normals, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute("skirtDrop", new THREE.BufferAttribute(new Float32Array(n), 1));
  g.setAttribute("biomeSdf0", new THREE.BufferAttribute(p.biomeSdf0, 4));
  g.setAttribute("biomeSdf1", new THREE.BufferAttribute(p.biomeSdf1, 4));
  g.setAttribute("biomePresence0", new THREE.BufferAttribute(p.biomePresence0, 4));
  g.setAttribute("biomePresence1", new THREE.BufferAttribute(p.biomePresence1, 4));
  g.setAttribute("riverbedSdf0", new THREE.BufferAttribute(p.riverbedSdf0, 4));
  g.setAttribute("riverbedSdf1", new THREE.BufferAttribute(p.riverbedSdf1, 4));
  g.setAttribute("riverBedDistance", new THREE.BufferAttribute(p.riverBedDistance, 1));
  g.setAttribute("distanceToRoadCenter", new THREE.BufferAttribute(p.distanceToRoadCenter, 1));
  g.setAttribute("distanceToFreewayCenter", new THREE.BufferAttribute(p.distanceToFreewayCenter, 1));
  g.setAttribute("freewayAlong", new THREE.BufferAttribute(p.freewayAlong, 1));
  g.setAttribute("underwaterDepth", new THREE.BufferAttribute(p.underwaterDepth, 1));
  g.setAttribute("entranceRock", new THREE.BufferAttribute(p.entranceRock, 2));
  g.setIndex(new THREE.BufferAttribute(p.indices, 1));
  g.boundingSphere = boundingSphereOf(p.positions);
  const mesh = own(new THREE.Mesh(g, entranceMaterial));
  mesh.onBeforeRender = syncEntranceFade(obj);
  return mesh;
};

/** A mesh's geometry from the worker's buffers; the culling sphere from one pass over the positions
 *  (THREE's computeBoundingSphere takes two, with a square root per vertex). */
const tunnelGeometry = (mesh: TunnelMesh): THREE.BufferGeometry => {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3));
  if (mesh.colors.length > 0) g.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  g.setAttribute("daylight", new THREE.BufferAttribute(mesh.daylight, 1));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  g.boundingSphere = boundingSphereOf(mesh.positions);
  return g;
};

const boundingSphereOf = (positions: Float32Array): THREE.Sphere => {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (!(minX <= maxX)) return new THREE.Sphere(new THREE.Vector3(), 0);
  return new THREE.Sphere(new THREE.Vector3((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2), Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
};

const buildLiquid = (chunk: UndergroundChunk, assets: TunnelAssets): THREE.Mesh | null => {
  // A spring cave's water is the terrain's water sheet (utils/workers/underground/springWater.ts); the
  // chunk's liquid triangles are only swum in.
  if (!chunk.liquid || chunk.style === "cave") return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(chunk.liquid.positions, 3));
  g.setIndex(new THREE.BufferAttribute(chunk.liquid.indices, 1));
  g.boundingSphere = boundingSphereOf(chunk.liquid.positions);
  return own(new THREE.Mesh(g, assets.liquid.material));
};


/** A door with its frame: the jambs and lintel (DOOR_FRAME_THICKNESS) stand INSIDE the wall's opening,
 *  and the leaf hangs between the jambs in the frame's plane, a hair smaller than the clear opening
 *  (door.ts `fit: "inside"`) — leaf, frame and wall never share a volume, closed or swinging. (A leaf
 *  overlapping the jambs read as bigger than its frame, Evan's screenshot.) */
const buildDoor = (chunk: UndergroundChunk, d: SewerDoor, assets: TunnelAssets, group: THREE.Group): DoorRuntime => {
  const frame = new THREE.Group();
  frame.position.set(d.x - chunk.centerX, d.y, d.z - chunk.centerZ);
  frame.rotation.y = d.yaw;
  const t = DOOR_FRAME_THICKNESS;
  const clearWidth = d.width - 2 * t;
  const clearHeight = d.height - t;
  const hinge = new THREE.Group();
  hinge.position.set(-clearWidth / 2, 0, 0);
  const { geometry } = makeDoorGeometry(clearWidth, clearHeight, DOOR_COLOR, DOOR_HANDLE, "inside");
  const leaf = own(new THREE.Mesh(geometry, assets.object.material));
  leaf.position.y = clearHeight / 2;
  hinge.add(leaf);
  frame.add(hinge);
  const parts = [
    new THREE.BoxGeometry(t, d.height, DOOR_FRAME_DEPTH).translate(-d.width / 2 + t / 2, d.height / 2, 0),
    new THREE.BoxGeometry(t, d.height, DOOR_FRAME_DEPTH).translate(d.width / 2 - t / 2, d.height / 2, 0),
    new THREE.BoxGeometry(clearWidth, t, DOOR_FRAME_DEPTH).translate(0, d.height - t / 2, 0),
  ].map((g) => bakeVertexColor(g.toNonIndexed(), FRAME_COLOR));
  const frameMesh = own(new THREE.Mesh(mergeOrThrow(parts, "door frame"), assets.object.material));
  frame.add(frameMesh);
  group.add(frame);
  return { id: d.id, door: d, hinge, leaf };
};

const poseMatrix = (pose: DiscPose, lift: number, centerX: number, centerZ: number, out: THREE.Matrix4): THREE.Matrix4 => {
  const n = new THREE.Vector3(pose.nx, pose.ny, pose.nz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  return out.compose(new THREE.Vector3(pose.x - centerX, pose.y + lift, pose.z - centerZ), q, new THREE.Vector3(1, 1, 1));
};

/** The cover's pose along its slide: between the two rests by a smoothstep, lifted midway, the tilt interpolated. */
export const applyCoverPose = (cover: CoverRuntime, centerX: number, centerZ: number): void => {
  const t = cover.progress;
  const s = smoothstep(0, 1, t);
  const a = cover.info.closed;
  const b = cover.info.aside;
  const nx = a.nx + (b.nx - a.nx) * s;
  const ny = a.ny + (b.ny - a.ny) * s;
  const nz = a.nz + (b.nz - a.nz) * s;
  const len = Math.hypot(nx, ny, nz) || 1;
  const pose: DiscPose = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s, nx: nx / len, ny: ny / len, nz: nz / len };
  poseMatrix(pose, COVER_SLIDE_LIFT * Math.sin(Math.PI * t), centerX, centerZ, cover.mesh.matrix);
  cover.mesh.matrix.decompose(cover.mesh.position, cover.mesh.quaternion, cover.mesh.scale);
  cover.mesh.updateMatrix();
  cover.mesh.updateMatrixWorld(true);
};

/** The frame ring draped on the sampled street around (cx, cz): its top FRAME_TOP_OVER_GROUND over
 *  the street, its feet FRAME_BELOW_GROUND under it, with an underside. */
const frameRingGeometry = (info: ManholeInfo, cx: number, cz: number): THREE.BufferGeometry => {
  const positions: number[] = [];
  const indices: number[] = [];
  const n = FRAME_SAMPLES;
  const ringVertex = (k: number, radius: number, y: number): number => {
    const ang = (k * 2 * Math.PI) / n;
    positions.push(cx + Math.cos(ang) * radius, y, cz + Math.sin(ang) * radius);
    return positions.length / 3 - 1;
  };
  for (let k = 0; k < n; k++) {
    const gi = info.frameGround[k * 2];
    const go = info.frameGround[k * 2 + 1];
    ringVertex(k, FRAME_INNER_RADIUS, gi + FRAME_TOP_OVER_GROUND);
    ringVertex(k, FRAME_OUTER_RADIUS, go + FRAME_TOP_OVER_GROUND);
    ringVertex(k, FRAME_INNER_RADIUS, gi - FRAME_BELOW_GROUND);
    ringVertex(k, FRAME_OUTER_RADIUS, go - FRAME_BELOW_GROUND);
  }
  // Each band's two triangles are wound to face its way (the top up, the underside down, the walls
  // outward and inward): with x = cos and z = sin the ring runs CLOCKWISE seen from above, so a
  // winding that reads right on paper faced the top annulus down (the frame tops were culled away).
  const facing = (i: number, j: number, k: number, nx: number, ny: number, nz: number): void => {
    const ax = positions[i * 3], ay = positions[i * 3 + 1], az = positions[i * 3 + 2];
    const ux = positions[j * 3] - ax, uy = positions[j * 3 + 1] - ay, uz = positions[j * 3 + 2] - az;
    const vx = positions[k * 3] - ax, vy = positions[k * 3 + 1] - ay, vz = positions[k * 3 + 2] - az;
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) indices.push(i, j, k);
    else indices.push(i, k, j);
  };
  for (let k = 0; k < n; k++) {
    const a = k * 4;
    const b = ((k + 1) % n) * 4;
    const ang = ((k + 0.5) * 2 * Math.PI) / n;
    const rx = Math.cos(ang);
    const rz = Math.sin(ang);
    // Top annulus, outer wall, inner wall, underside.
    facing(a, a + 1, b + 1, 0, 1, 0);
    facing(a, b + 1, b, 0, 1, 0);
    facing(a + 1, a + 3, b + 3, rx, 0, rz);
    facing(a + 1, b + 3, b + 1, rx, 0, rz);
    facing(a + 2, a, b, -rx, 0, -rz);
    facing(a + 2, b, b + 2, -rx, 0, -rz);
    facing(a + 3, a + 2, b + 2, 0, -1, 0);
    facing(a + 3, b + 2, b + 3, 0, -1, 0);
  }
  const ring = new THREE.BufferGeometry();
  ring.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  ring.setIndex(indices);
  ring.computeVertexNormals();
  ring.computeBoundingSphere();
  return ring;
};

/** The ladder: rungs from the box floor up to just under the street, rails continuous; centered on
 *  the middle of its run, facing +x. */
const ladderMesh = (info: ManholeInfo, material: THREE.Material): THREE.Mesh => {
  const bottom = info.floorY + RUNG_FROM_FLOOR;
  const top = info.streetY - RUNG_TO_STREET;
  const parts: THREE.BufferGeometry[] = [];
  for (let y = bottom; y <= top; y += RUNG_SPACING) parts.push(new THREE.BoxGeometry(RUNG_SIZE, RUNG_SIZE, RUNG_WIDTH).translate(0, y - (bottom + top) / 2, 0));
  for (const side of [-1, 1]) parts.push(new THREE.BoxGeometry(RUNG_SIZE, top - bottom + RUNG_SIZE, RUNG_SIZE).translate(0, 0, side * (RUNG_WIDTH / 2)));
  const ladder = own(new THREE.Mesh(mergeOrThrow(parts.map((g) => bakeVertexColor(g.toNonIndexed(), RUNG_COLOR)), "ladder"), material));
  ladder.position.y = (bottom + top) / 2;
  return ladder;
};

/** A manhole's frame ring, ladder and cover; returns the cover's runtime. */
const buildManhole = (chunk: UndergroundChunk, e: TunnelEntrance, assets: TunnelAssets, group: THREE.Group): CoverRuntime => {
  const info = e.manhole!;
  const cx = e.x - chunk.centerX;
  const cz = e.z - chunk.centerZ;
  group.add(own(new THREE.Mesh(frameRingGeometry(info, cx, cz), assets.iron)));
  const ladder = ladderMesh(info, assets.object.material);
  ladder.position.x = cx + info.faceX * LADDER_OFFSET;
  ladder.position.z = cz + info.faceZ * LADDER_OFFSET;
  ladder.rotation.y = yawFromDir(info.faceX, info.faceZ);
  group.add(ladder);
  const mesh = own(new THREE.Mesh(assets.cover, assets.iron));
  mesh.userData.ownsGeometry = false;
  group.add(mesh);
  const cover: CoverRuntime = { id: e.id, entrance: e, info, mesh, progress: isOpen(e.id) ? 1 : 0, target: isOpen(e.id) ? 1 : 0 };
  applyCoverPose(cover, chunk.centerX, chunk.centerZ);
  return cover;
};

/** The chunk's collider bodies (the server's NPCs get the same: colliderBodies.ts). */
export const chunkColliderBodies = (obj: TunnelChunkObject): ColliderBody[] => tunnelColliderBodies(obj.chunk, isOpen);

/** Builds a chunk's objects; `entranceMaterial` is the terrain's ENTRANCE variant (null until the terrain
 *  material exists: the patch is then not drawn). */
export const buildChunkObject = (chunk: UndergroundChunk, assets: TunnelAssets, entranceMaterial: THREE.ShaderMaterial | null): TunnelChunkObject => {
  const group = new THREE.Group();
  group.position.set(chunk.centerX, 0, chunk.centerZ);
  const obj: TunnelChunkObject = { chunk, group, walls: null, patch: null, caps: [], doors: [], doorHinges: [], doorsOpen: [], covers: [], mouthIds: chunk.entranceMouths.map((m) => m.id), fade: chunk.entranceMouths.length === 0 ? 1 : 0, points: [] };
  obj.walls = buildWalls(chunk, assets, obj);
  if (obj.walls) group.add(obj.walls);
  for (const cap of chunk.caps) {
    const mesh = own(new THREE.Mesh(tunnelGeometry(cap.mesh), assets.sewerWall.material));
    group.add(mesh);
    obj.caps.push({ neighbor: cap.neighbor, mesh });
  }
  obj.patch = buildPatch(chunk, entranceMaterial, obj);
  if (obj.patch) group.add(obj.patch);
  const liquid = buildLiquid(chunk, assets);
  if (liquid) group.add(liquid);
  for (const d of chunk.doors) {
    const door = buildDoor(chunk, d, assets, group);
    obj.doors.push(door);
    obj.doorHinges.push(door.hinge);
    obj.doorsOpen.push(isOpen(door.id));
  }
  for (const e of chunk.entrances) if (e.kind === "manhole" && e.manhole) obj.covers.push(buildManhole(chunk, e, assets, group));
  obj.points = chunkColliderBodies(obj);
  return obj;
};
