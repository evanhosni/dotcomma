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
