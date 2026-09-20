import * as THREE from "three";
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

export const getDistance2DSq = (pos1: THREE.Vector3, pos2: THREE.Vector3): number => {
  const dx = pos1.x - pos2.x;
  const dz = pos1.z - pos2.z;
  return dx * dx + dz * dz;
};

/** Phase-offsets an object's every-Nth-frame work so a spawn batch doesn't all fire on the same frame (CLAUDE.md Performance Notes). */
export const framePhaseFromCoords = (x: number, z: number, interval: number): number =>
  Math.abs(Math.floor(x * 7.13 + z * 3.71)) % interval;
