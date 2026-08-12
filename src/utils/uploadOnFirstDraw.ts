/**
 * Mount-time GPU warm-up.
 *
 * three uploads a mesh's geometry buffers/textures and links its shader
 * program on the mesh's FIRST DRAW — content mounted off-screen (a spawn
 * radius is a circle; the player faces one way) otherwise defers its entire
 * GPU cost to the frame the player first turns toward it, and a fast 180°
 * cashes in EVERY deferred upload at once (the turn-around lag spike).
 *
 * Mount time is already staggered (spawn batches, budgeted chunk builds), so
 * paying the upload there flattens the storm. Applied to terrain chunks,
 * building meshes, grass chunks, dressing chunks, and GLTF actors — apply it
 * to any NEW mass content that can mount off-screen. (Objects whose own code
 * sets `visible = false` at mount must also keep themselves visible until the
 * forced draw has happened — see GameObject / DayNightCycle warm frames.)
 */

/** Force ONE real draw of a mesh regardless of the camera frustum, then
 *  restore normal culling. The single off-frustum draw costs its vertex work
 *  only (no fragments), and a mesh whose `visible` is false stays deferred
 *  until it is shown — the flag simply persists until the first actual draw. */
export const uploadOnFirstDraw = (mesh: import("three").Object3D): void => {
  mesh.frustumCulled = false;
  const prev = mesh.onAfterRender;
  mesh.onAfterRender = function (this: any, ...args: any[]) {
    mesh.frustumCulled = true;
    mesh.onAfterRender = prev;
    (prev as any)?.apply(this, args);
  } as typeof mesh.onAfterRender;
};
