import type { PointXZ } from "../../utils/math/types";
import { CHUNK_SIZE, LOD1_SITE_DISTANCE, LOD1_SITE_REACH, LOD3_CHUNK_SIZE, LOD4_CHUNK_SIZE, LOD_LEVELS, LODLevel, MAX_RENDER_DISTANCE } from "./lodConfig";

export type DesiredChunks = { [key: string]: { position: number[]; lod: LODLevel } };

const lodBySize: { [size: number]: LODLevel } = {};
for (const lod of LOD_LEVELS) lodBySize[lod.chunkSize] = lod;

const subdivideThreshold: { [size: number]: number } = {
  [LOD4_CHUNK_SIZE]: LOD_LEVELS[2].maxDistance, // 1680 subdivides at LOD3.maxDist (3360)
  [LOD3_CHUNK_SIZE]: LOD_LEVELS[1].maxDistance, // 840 subdivides at LOD2.maxDist (1680)
};

/** Distance from (px, pz) to the nearest point of the square [ox, ox + size] × [oz, oz + size]. */
const distanceToSquare = (ox: number, oz: number, size: number, px: number, pz: number): number => {
  const clampedX = Math.max(ox, Math.min(px, ox + size));
  const clampedZ = Math.max(oz, Math.min(pz, oz + size));
  return Math.sqrt((clampedX - px) ** 2 + (clampedZ - pz) ** 2);
};

// LOD1 SITES: the cave mouths whose footprint chunks are all loaded (the underground registry sets them).
// A 420u chunk within LOD1_SITE_REACH of one draws at LOD1 out to LOD1_SITE_DISTANCE, past the LOD1 ring,
// so the entrance's patch stands on the ground LOD1 draws.
let lod1Sites: PointXZ[] = [];
let lod1SitesVersion = 0;

export const setLod1Sites = (sites: PointXZ[]): void => {
  lod1Sites = sites;
  lod1SitesVersion++;
};
export const getLod1SitesVersion = (): number => lod1SitesVersion;

const nearLod1Site = (ox: number, oz: number, size: number, playerX: number, playerZ: number): boolean => {
  if (lod1Sites.length === 0) return false;
  if (distanceToSquare(ox, oz, size, playerX, playerZ) >= LOD1_SITE_DISTANCE) return false;
  for (const s of lod1Sites) if (distanceToSquare(ox, oz, size, s.x, s.z) <= LOD1_SITE_REACH) return true;
  return false;
};

/** The key of the LOD1 chunk holding a world point. */
export const lod1KeyAt = (x: number, z: number): string => `1/${Math.round((Math.floor(x / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE / 2) / CHUNK_SIZE)}/${Math.round((Math.floor(z / CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE / 2) / CHUNK_SIZE)}`;

/** The quadtree's leaves around the player: a PARTITION of every LOD4 root within the render disc,
 *  keyed `${level}/${gx}/${gz}`. */
export const computeDesiredChunks = (playerX: number, playerZ: number): DesiredChunks => {
  const desired: DesiredChunks = {};

  const visitNode = (ox: number, oz: number, size: number) => {
    const dist = distanceToSquare(ox, oz, size, playerX, playerZ);

    if (size > CHUNK_SIZE) {
      const threshold = subdivideThreshold[size];
      if (threshold !== undefined && dist < threshold) {
        const half = size / 2;
        visitNode(ox, oz, half);
        visitNode(ox + half, oz, half);
        visitNode(ox, oz + half, half);
        visitNode(ox + half, oz + half, half);
        return;
      }
    }

    let lod = lodBySize[size];
    if (!lod) lod = LOD_LEVELS[0];
    if (size === CHUNK_SIZE) lod = dist < LOD_LEVELS[0].maxDistance || nearLod1Site(ox, oz, size, playerX, playerZ) ? LOD_LEVELS[0] : LOD_LEVELS[1];

    const cx = ox + lod.chunkSize / 2;
    const cz = oz + lod.chunkSize / 2;
    const gx = Math.round(cx / lod.chunkSize);
    const gz = Math.round(cz / lod.chunkSize);
    desired[`${lod.level}/${gx}/${gz}`] = { position: [cx, cz], lod };
  };

  const rootSize = LOD4_CHUNK_SIZE;
  const radius = Math.ceil(MAX_RENDER_DISTANCE / rootSize);
  const rootGX = Math.floor(playerX / rootSize);
  const rootGZ = Math.floor(playerZ / rootSize);

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const ox = (rootGX + dx) * rootSize;
      const oz = (rootGZ + dz) * rootSize;
      if (distanceToSquare(ox, oz, rootSize, playerX, playerZ) > MAX_RENDER_DISTANCE) continue;
      visitNode(ox, oz, rootSize);
    }
  }

  return desired;
};
