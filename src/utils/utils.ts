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

/** Deterministic per-instance frame phase from a spawn position, so a batch
 *  of objects mounted together doesn't do its every-Nth-frame work (throttled
 *  distance checks, physics, raycasts) all on the same frame — phase-offset
 *  throttling is a codebase rule (see CLAUDE.md Performance Notes). */
export const framePhaseFromCoords = (x: number, z: number, interval: number): number =>
  Math.abs(Math.floor(x * 7.13 + z * 3.71)) % interval;
