import { Biome, Region } from "../world/types";

export const getAllBiomes = (regions: Region[]): Biome[] => {
  return Array.from(
    new Set(
      regions.reduce((biomes: Biome[], region: Region) => {
        return biomes.concat(region.biomes);
      }, [])
    )
  );
};

export const getDistance2D = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return Math.sqrt(dx * dx + dz * dz);
};

/** Squared 2D distance — use wherever the result is only COMPARED against a
 *  threshold (compare vs threshold²) so hot per-frame paths skip the sqrt. */
export const getDistance2DSq = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return dx * dx + dz * dz;
};

/** Force ONE real draw of a mesh regardless of the camera frustum, then
 *  restore normal culling. three uploads geometry buffers/textures and links
 *  the shader program on a mesh's FIRST DRAW — content mounted off-screen
 *  otherwise defers its entire GPU upload to the frame the player first turns
 *  toward it, and a fast 180° cashes in EVERY deferred upload at once (the
 *  turn-around lag spike). Mount time is already staggered (spawn batches,
 *  budgeted chunk builds), so paying the upload there flattens the storm.
 *  The one off-frustum draw costs its vertex work only (no fragments), and a
 *  mesh whose `visible` is false stays deferred until it's shown — the flag
 *  simply persists until the first actual draw. */
export const uploadOnFirstDraw = (mesh: import("three").Object3D): void => {
  mesh.frustumCulled = false;
  const prev = mesh.onAfterRender;
  mesh.onAfterRender = function (this: any, ...args: any[]) {
    mesh.frustumCulled = true;
    mesh.onAfterRender = prev;
    (prev as any)?.apply(this, args);
  } as typeof mesh.onAfterRender;
};
