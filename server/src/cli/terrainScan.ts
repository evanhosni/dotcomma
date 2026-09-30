import { computeVertexData, computeVertexDataRaw, type VertexResult } from "../../../src/utils/workers/vertexCompute";
import { snapToVertex, TERRAIN_CHUNK_SIZE, TERRAIN_SEGMENTS } from "../game/physics/terrain.js";

/**
 * Finds real places to test the physics world on. Slope is the analytic gradient
 * at LOD1 vertex spacing (what the heightfield resolves) and candidates are
 * heightfield VERTICES, where the collider surface is exact.
 */

export const VERTEX_SPACING = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS; // 4.375

export interface SlopeSample {
  x: number;
  z: number;
  height: number;
  /** From horizontal, radians. */
  angle: number;
  /** Unit horizontal direction pointing UPHILL. */
  ux: number;
  uz: number;
}

/** Central differences one vertex apart. */
export const slopeAt = (x: number, z: number, sample: (x: number, z: number) => VertexResult = computeVertexData): SlopeSample => {
  const s = VERTEX_SPACING;
  const h = sample(x, z).height;
  const dhdx = (sample(x + s, z).height - sample(x - s, z).height) / (2 * s);
  const dhdz = (sample(x, z + s).height - sample(x, z - s).height) / (2 * s);
  const g = Math.hypot(dhdx, dhdz);
  return { x, z, height: h, angle: Math.atan(g), ux: g > 1e-9 ? dhdx / g : 1, uz: g > 1e-9 ? dhdz / g : 0 };
};

/** Outward square spiral; "deep" = fully blended in, 300u clear of rivers and biome walls. */
export const findBiomePatch = (biomeId: number, stride = 100, maxRadius = 20000): { x: number; z: number } | null => {
  for (let r = 0; r <= maxRadius; r += stride) {
    for (let x = -r; x <= r; x += stride) {
      for (let z = -r; z <= r; z += stride) {
        if (Math.abs(x) !== r && Math.abs(z) !== r) continue;
        const v = computeVertexDataRaw(x, z);
        if (v.biomeId !== biomeId || v.blend < 1) continue;
        if (v.distanceToRiverCenter < 300 || v.distanceToBiomeBoundaryCenter < 300) continue;
        return { x, z };
      }
    }
  }
  return null;
};

export interface SlopeSpotOptions {
  minDeg: number;
  maxDeg: number;
  radius?: number;
  /** The whole 3×3 neighborhood in range too — capsule-solid, not a one-triangle sliver. */
  solid?: boolean;
  /** Skip road corridors: a freeway grade's ramp edge is a steep but only ~1u-tall cut, not a
   *  natural slope (a steep scan landed on one once the rivers moved the grass patch). */
  offRoad?: boolean;
}

/** Normalized street units: the road field is written out to FREEWAY_FIELD_REACH (70u real = 35
 *  normalized) and is 99999 elsewhere, so this rejects every point the field reaches. */
const ROAD_CORRIDOR = 40;

/** Every point of the 3×3 vertex neighborhood around (x, z) has a slope in range. */
const neighborhoodInRange = (x: number, z: number, inRange: (angle: number) => boolean, sample?: (x: number, z: number) => VertexResult): boolean => {
  const s = VERTEX_SPACING;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (!inRange(slopeAt(x + a * s, z + b * s, sample).angle)) return false;
  return true;
};

/** Scans the RAW surface first (cheap), confirms with the padded one the collider is built from. */
export const findSlopeSpot = (cx: number, cz: number, opts: SlopeSpotOptions): SlopeSample | null => {
  const { minDeg, maxDeg, radius = 300, solid = true, offRoad = false } = opts;
  const lo = (minDeg * Math.PI) / 180;
  const hi = (maxDeg * Math.PI) / 180;
  const s = VERTEX_SPACING;
  const origin = snapToVertex(cx, cz);
  const inRange = (a: number) => a >= lo && a <= hi;
  const n = Math.floor(radius / s);
  for (let ring = 0; ring <= n; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.abs(i) !== ring && Math.abs(j) !== ring) continue;
        const x = origin.x + i * s;
        const z = origin.z + j * s;
        const raw = slopeAt(x, z, computeVertexDataRaw);
        if (!inRange(raw.angle)) continue;
        if (offRoad && computeVertexDataRaw(x, z).distanceToRoadCenter < ROAD_CORRIDOR) continue;
        if (solid && !neighborhoodInRange(x, z, inRange, computeVertexDataRaw)) continue;
        const padded = slopeAt(x, z);
        if (!inRange(padded.angle)) continue;
        if (solid && !neighborhoodInRange(x, z, inRange)) continue;
        return padded;
      }
    }
  }
  return null;
};

export const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(1) + "°";
