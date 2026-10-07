import * as THREE from "three";
import { Biome, Region } from "../world/types";

/** Every biome of the regions, once each (a biome listed by two regions is one object), in region → biome order. */
export const getAllBiomes = (regions: Region[]): Biome[] => Array.from(new Set(regions.flatMap((region) => region.biomes)));

export const getDistance2DSq = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return dx * dx + dz * dz;
};

/** Phase-offsets an object's every-Nth-frame work so a spawn batch doesn't all fire on the same frame (CLAUDE.md Performance Notes). */
export const framePhaseFromCoords = (x: number, z: number, interval: number): number =>
  Math.abs(Math.floor(x * 7.13 + z * 3.71)) % interval;

/** Same rule as three r157's updateMatrixWorld loop, which skipped a child whose matrixWorldAutoUpdate is
 *  false unless forced; r164+ descends anyway and composes every matrixAutoUpdate node below it. */
function updateMatrixWorldStoppingWhenFrozen(this: THREE.Object3D, force?: boolean): void {
  if (!this.matrixWorldAutoUpdate && !force) return;
  THREE.Object3D.prototype.updateMatrixWorld.call(this, force);
}

/** Makes `matrixWorldAutoUpdate = false` on `object` stop the renderer's per-frame matrix update at it,
 *  subtree included, on every three version (the actor base parks culled and far actors that way).
 *  Without it r170 composed every parked actor's nodes each frame: +0.44ms of updateMatrixWorld per
 *  frame in the city (CPU profile, 64 → 160 ms/s). */
export const stopMatrixUpdatesWhenFrozen = (object: THREE.Object3D): void => {
  object.updateMatrixWorld = updateMatrixWorldStoppingWhenFrozen;
};

/** Composes `object`'s subtree once and stops it composing every frame. For content placed once
 *  that never moves (terrain/dressing/foliage chunks, their root groups) — CLAUDE.md Performance Notes. */
export const freezeStaticSubtree = (object: THREE.Object3D): void => {
  object.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
};
