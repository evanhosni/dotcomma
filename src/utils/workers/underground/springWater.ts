/**
 * The spring caves' water as the TERRAIN's water sheet draws it: `springWaterAt` is step 8 of
 * computeVertexData, giving a vertex under the mountain the level, depth and flow of the cave water
 * it stands in, and a vertex within SPRING_WATER_MARGIN of that water a DIVE level (depth < 0): the
 * sheet's dry vertices there dive under the cave's water instead of under the mountain above, so
 * no triangle of the sheet climbs through the cave's air. Polygons are fetched per MOUTH_TILE tile
 * like the mouths (mouthBulge.ts).
 */
import type { RectXZ } from "../../math/types";
import { caveBiomeIds } from "./params";
import { dropOldestHalf } from "../cellCache";
import { MOUTH_TILE, MOUTH_TILE_CACHE_MAX, SPRING_WATER_MARGIN } from "./constants";
import { systemsNear } from "./systems";
import type { SpringWater } from "./types";

export interface SpringWaterSample {
  level: number;
  /** The water's depth where the vertex stands in it; negative within the margin around it (a dive). */
  depth: number;
  flowX: number;
  flowZ: number;
}

const NO_WATER: readonly SpringWater[] = [];
const tiles = new Map<number, readonly SpringWater[]>();
let lastTileKey = NaN;
let lastTile = NO_WATER;

export const clearSpringWaterTiles = (): void => {
  tiles.clear();
  lastTileKey = NaN;
  lastTile = NO_WATER;
};

const touchesTile = (w: SpringWater, tile: RectXZ): boolean => {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of w.points) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  const m = SPRING_WATER_MARGIN;
  return maxX + m > tile.minX && minX - m < tile.maxX && maxZ + m > tile.minZ && minZ - m < tile.maxZ;
};

const springWaterNear = (x: number, z: number): readonly SpringWater[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return NO_WATER;
  const tx = Math.floor(x / MOUTH_TILE);
  const tz = Math.floor(z / MOUTH_TILE);
  const key = tx * 0x200000 + tz;
  if (key === lastTileKey) return lastTile;
  let list = tiles.get(key);
  if (!list) {
    if (tiles.size >= MOUTH_TILE_CACHE_MAX) dropOldestHalf(tiles);
    const minX = tx * MOUTH_TILE;
    const minZ = tz * MOUTH_TILE;
    const tile: RectXZ = { minX, minZ, maxX: minX + MOUTH_TILE, maxZ: minZ + MOUTH_TILE };
    const found: SpringWater[] = [];
    for (const id of ids) {
      for (const s of systemsNear("cave", id, tile, SPRING_WATER_MARGIN)) {
        for (const w of s.liquid ?? []) if (touchesTile(w, tile)) found.push(w);
      }
    }
    list = found.length > 0 ? found : NO_WATER;
    tiles.set(key, list);
  }
  lastTileKey = key;
  lastTile = list;
  return list;
};

/** The water's height at (x, z) inside the polygon (a fan of triangles, interpolated), or NaN outside. */
const levelInside = (w: SpringWater, x: number, z: number): number => {
  const pts = w.points;
  const [ax, ay, az] = pts[0];
  for (let k = 1; k + 1 < pts.length; k++) {
    const [bx, by, bz] = pts[k];
    const [cx, cy, cz] = pts[k + 1];
    const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (det === 0) continue;
    const u = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) / det;
    const v = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) / det;
    if (u < 0 || v < 0 || u + v > 1) continue;
    return ay + (by - ay) * u + (cy - ay) * v;
  }
  return NaN;
};

/** The squared distance from (x, z) to the polygon's outline and the water's height at the nearest point. */
const nearestOnOutline = (w: SpringWater, x: number, z: number, out: { d2: number; y: number }): void => {
  const pts = w.points;
  out.d2 = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[(i + 1) % pts.length];
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t - x;
    const pz = az + dz * t - z;
    const d2 = px * px + pz * pz;
    if (d2 < out.d2) {
      out.d2 = d2;
      out.y = ay + (by - ay) * t;
    }
  }
};

const nearest = { d2: Infinity, y: NaN };

/** Whether (x, z) stands in a spring cave's water or within SPRING_WATER_MARGIN of it; `out` is then
 *  the water's level, depth (negative within the margin) and flow. */
export const springWaterAt = (x: number, z: number, out: SpringWaterSample): boolean => {
  const waters = springWaterNear(x, z);
  if (waters.length === 0) return false;
  let diveD2 = SPRING_WATER_MARGIN * SPRING_WATER_MARGIN;
  let diveY = NaN;
  for (const w of waters) {
    const level = levelInside(w, x, z);
    if (!Number.isNaN(level)) {
      out.level = level;
      out.depth = w.depth;
      out.flowX = w.flowX;
      out.flowZ = w.flowZ;
      return true;
    }
    nearestOnOutline(w, x, z, nearest);
    if (nearest.d2 < diveD2) {
      diveD2 = nearest.d2;
      diveY = nearest.y;
    }
  }
  if (Number.isNaN(diveY)) return false;
  out.level = diveY;
  out.depth = -1;
  out.flowX = 0;
  out.flowZ = 0;
  return true;
};
