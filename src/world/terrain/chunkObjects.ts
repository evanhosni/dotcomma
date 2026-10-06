import type Rapier from "@dimforge/rapier3d-compat";
import * as THREE from "three";
import { traceEvent } from "../../utils/spikeTrace";
import { uploadOnFirstDraw } from "../../utils/uploadOnFirstDraw";
import { LOD_FADE_UNIFORM } from "../shaders/lodFade";
import { getWaterMaterial } from "../water/waterMaterial";
import { acquireGeometry, releaseGeometry } from "./chunkGeometry";
import type { LODLevel } from "./lodConfig";
import type { Chunk } from "./types";

// What a terrain chunk owns in the scene and the physics world: its plane, its water child and its
// heightfield body.

/** A chunk's dither range into whichever material draws it (the fade variant, or the water): three
 *  uploads a shared material's uniforms only on a program switch or uniformsNeedUpdate, so each
 *  mesh writes its own range right before its draw. The opaque terrain material has no uLodFade. */
export const syncLodFade =
  (chunk: Chunk) =>
  (_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, _camera: THREE.Camera, _geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const uniform = (material as THREE.ShaderMaterial).uniforms?.[LOD_FADE_UNIFORM];
    if (!uniform) return;
    const range = uniform.value as THREE.Vector2;
    if (range.x === chunk.fadeLo && range.y === chunk.fadeHi) return;
    range.set(chunk.fadeLo, chunk.fadeHi);
    (material as THREE.ShaderMaterial).uniformsNeedUpdate = true;
  };

/** A new chunk's plane, hidden until its swap draws it and static once placed (the build re-composes it). */
export const createChunkPlane = (lod: LODLevel, material: THREE.Material): THREE.Mesh => {
  const plane = new THREE.Mesh(acquireGeometry(lod), material);
  plane.visible = false; //TODO problemA: maybe somewhere around here, not sure. plane flashes briefly at 0,0,0 before moving to its correct spot. one solution is add 50 to the height or smth, but thats too hacky. try to prevent this flashing
  plane.castShadow = false;
  // receiveShadow left on would recompile every terrain program the day a light casts a shadow.
  plane.receiveShadow = false;
  plane.rotation.x = -Math.PI / 2;
  plane.matrixAutoUpdate = false;
  plane.updateMatrix();
  uploadOnFirstDraw(plane);
  return plane;
};

/** Drops a chunk's water surface back into the geometry pool (it shares the terrain's LOD family). */
export const releaseWater = (chunk: Chunk) => {
  if (!chunk.water) return;
  chunk.plane.remove(chunk.water);
  releaseGeometry(chunk.lod, chunk.water.geometry);
  chunk.water = null;
};

/** The chunk's water mesh: a CHILD of its plane, so it shares the transform, visibility and LOD swaps. */
export const ensureWaterMesh = (chunk: Chunk): THREE.Mesh => {
  if (chunk.water) return chunk.water;
  const water = new THREE.Mesh(acquireGeometry(chunk.lod), getWaterMaterial());
  water.castShadow = false;
  water.receiveShadow = false;
  water.renderOrder = 10;
  water.matrixAutoUpdate = false; // identity under its plane
  // Warmed with its plane like every streamed mesh: the first water in view otherwise compiled the
  // water program and uploaded its buffers at the frame the player turned to it.
  uploadOnFirstDraw(water);
  water.onBeforeRender = syncLodFade(chunk);
  chunk.plane.add(water);
  chunk.water = water;
  return water;
};

/** Heightfield (column-major heights from the worker) straight into the Rapier world — never a React
 *  <RigidBody>, see CLAUDE.md. The desc is created before the body so a failure can't leave an empty body
 *  behind; the body lands on `chunk.colliderBody`. */
export const generateColliders = (world: Rapier.World, rapier: typeof Rapier, chunk: Chunk, heights: Float32Array): void => {
  const { segments, chunkSize } = chunk.lod;
  const t0 = performance.now();
  const desc = rapier.ColliderDesc.heightfield(segments, segments, heights, { x: chunkSize, y: 1, z: chunkSize });
  const body = world.createRigidBody(rapier.RigidBodyDesc.fixed().setTranslation(chunk.offset.x, 0, chunk.offset.z));
  try {
    world.createCollider(desc, body);
  } catch (e) {
    world.removeRigidBody(body);
    console.error("terrain heightfield collider failed:", e);
    return;
  }
  chunk.colliderBody = body;
  traceEvent("terrain:collider", performance.now() - t0);
};
