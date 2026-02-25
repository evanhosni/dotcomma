export interface LODLevel {
  level: number;
  chunkSize: number;
  segments: number;
  maxDistance: number;
  hasCollider: boolean;
}

export const LOD_LEVELS: LODLevel[] = [
  { level: 0, chunkSize: 420, segments: 42, maxDistance: 840, hasCollider: true },
  { level: 1, chunkSize: 420, segments: 14, maxDistance: 2520, hasCollider: false },
  { level: 2, chunkSize: 420, segments: 6, maxDistance: 5040, hasCollider: false },
];

export const MAX_RENDER_DISTANCE = 5040;
