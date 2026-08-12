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
