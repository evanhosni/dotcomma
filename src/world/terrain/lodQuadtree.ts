import { CHUNK_SIZE, LOD5_CHUNK_SIZE, LOD_LEVELS, LODLevel, MAX_RENDER_DISTANCE } from "./lodConfig";

export type DesiredChunks = { [key: string]: { position: number[]; lod: LODLevel } };

const lodBySize: { [size: number]: LODLevel } = {};
for (const lod of LOD_LEVELS) lodBySize[lod.chunkSize] = lod;

const subdivideThreshold: { [size: number]: number } = {
  [LOD5_CHUNK_SIZE]: LOD_LEVELS[3].maxDistance, // 3360 subdivides at LOD4.maxDist (6720)
  [LOD5_CHUNK_SIZE / 2]: LOD_LEVELS[2].maxDistance, // 1680 subdivides at LOD3.maxDist (3360)
  [LOD5_CHUNK_SIZE / 4]: LOD_LEVELS[1].maxDistance, // 840 subdivides at LOD2.maxDist (1680)
};

/** Distance from (px, pz) to the nearest point of the square [ox, ox + size] × [oz, oz + size]. */
const distanceToSquare = (ox: number, oz: number, size: number, px: number, pz: number): number => {
  const clampedX = Math.max(ox, Math.min(px, ox + size));
  const clampedZ = Math.max(oz, Math.min(pz, oz + size));
  return Math.sqrt((clampedX - px) ** 2 + (clampedZ - pz) ** 2);
};

/** The quadtree's leaves around the player: a PARTITION of every LOD5 root within the render disc,
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
    if (size === CHUNK_SIZE) lod = dist < LOD_LEVELS[0].maxDistance ? LOD_LEVELS[0] : LOD_LEVELS[1];

    const cx = ox + lod.chunkSize / 2;
    const cz = oz + lod.chunkSize / 2;
    const gx = Math.round(cx / lod.chunkSize);
    const gz = Math.round(cz / lod.chunkSize);
    desired[`${lod.level}/${gx}/${gz}`] = { position: [cx, cz], lod };
  };

  const rootSize = LOD5_CHUNK_SIZE;
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
