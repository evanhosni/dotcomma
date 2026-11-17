import * as THREE from "three";

/**
 * Mount-time GPU warm-up: three uploads buffers and links the program on a mesh's
 * FIRST DRAW, so off-screen content deferred it all to the frame the player first
 * turned toward it (the turn-around lag spike). One off-frustum draw costs vertex
 * work only. Apply to any mass content that can mount off-screen; a mesh that hides
 * itself at mount must stay visible until the forced draw happened. See CLAUDE.md.
 */
export const uploadOnFirstDraw = (mesh: import("three").Object3D): void => {
  mesh.frustumCulled = false;
  const prev = mesh.onAfterRender;
  mesh.onAfterRender = function (this: any, ...args: any[]) {
    mesh.frustumCulled = true;
    mesh.onAfterRender = prev;
    (prev as any)?.apply(this, args);
  } as typeof mesh.onAfterRender;
};

export const getDistance2DSq = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return dx * dx + dz * dz;
};

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
