import * as THREE from "three";
import { prepareActorMaterial } from "../Actor";

/**
 * The door leaves of every building beyond its live distance, as ONE InstancedMesh (one draw call
 * for all of them). A leaf per mesh was one lit draw per door out to 625u, which is why far doors
 * used to be hidden; inside the live distance Building.tsx draws the real, clickable leaves.
 *
 * Instances are placed relative to a rebase origin near the camera (the mesh's position), so the GPU
 * never sees an absolute world coordinate (CLAUDE.md → Coordinate Precision).
 */

export interface FarDoorSpec {
  /** Where the door's hinge group sits in the world: building coordinates + the plan's door position. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Door opening width: the hinge is at -width/2 along the door's x. */
  width: number;
  /** The leaf box relative to the hinge (ProceduralBuildingAssets.doorLeaf). */
  leafCenter: [number, number, number];
  leafSize: [number, number, number];
  color: number;
}

export interface FarDoor extends FarDoorSpec {
  angle: number;
  /** Its building's spawn-fade visibility (the per-instance aSpawnFade). */
  fade: number;
  index: number;
}

const INITIAL_CAPACITY = 1024;
const REBASE_DISTANCE = 2000;

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
  for (const door of doors) {
    writeMatrix(door);
    writeColor(door);
    writeFade(door);
  }
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
  writeMatrix(door);
  writeColor(door);
  writeFade(door);
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
    writeMatrix(last);
    writeColor(last);
    writeFade(last);
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
