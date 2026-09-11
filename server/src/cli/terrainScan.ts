import { computeVertexData, computeVertexDataRaw, type VertexResult } from "../../../src/utils/workers/vertexCompute";
import { snapToVertex, TERRAIN_CHUNK_SIZE, TERRAIN_SEGMENTS } from "../game/physics/terrain.js";

/**
 * TERRAIN SCANNING — finds real places to test the physics world on: a patch
 * deep inside a biome, and spots of a given steepness inside it. Slope is the
 * analytic surface's gradient measured at the LOD1 vertex spacing (what the
 * heightfield actually resolves), and candidates are heightfield VERTICES so
 * the collider surface is exact there. Used by the demo CLI and the tests.
 */

export const VERTEX_SPACING = TERRAIN_CHUNK_SIZE / TERRAIN_SEGMENTS; // 4.375

export interface SlopeSample {
  x: number;
  z: number;
  height: number;
  /** Surface angle from horizontal, radians. */
  angle: number;
  /** Unit horizontal direction pointing UPHILL. */
  ux: number;
  uz: number;
}

/** Slope at a point from central differences one vertex apart. */
export const slopeAt = (x: number, z: number, sample: (x: number, z: number) => VertexResult = computeVertexData): SlopeSample => {
  const s = VERTEX_SPACING;
  const h = sample(x, z).height;
  const dhdx = (sample(x + s, z).height - sample(x - s, z).height) / (2 * s);
  const dhdz = (sample(x, z + s).height - sample(x, z - s).height) / (2 * s);
  const g = Math.hypot(dhdx, dhdz);
  return { x, z, height: h, angle: Math.atan(g), ux: g > 1e-9 ? dhdx / g : 1, uz: g > 1e-9 ? dhdz / g : 0 };
};

/** First point on an outward square spiral (step `stride`) that sits deep
 *  inside `biomeId`: fully blended in, well clear of rivers and biome walls. */
export const findBiomePatch = (biomeId: number, stride = 100, maxRadius = 20000): { x: number; z: number } | null => {
  for (let r = 0; r <= maxRadius; r += stride) {
    for (let x = -r; x <= r; x += stride) {
      for (let z = -r; z <= r; z += stride) {
        if (Math.abs(x) !== r && Math.abs(z) !== r) continue; // ring only
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
  /** Search radius around the patch center. */
  radius?: number;
  /** Require every vertex in the 3×3 neighborhood to be in range too — a
   *  "capsule-solid" spot rather than a one-triangle sliver. */
  solid?: boolean;
}

/** A heightfield vertex inside the patch whose slope (padded surface — what
 *  the collider is built from) lies in [minDeg, maxDeg]. Scans the RAW surface
 *  first (cheap) and confirms with the padded one. */
export const findSlopeSpot = (cx: number, cz: number, opts: SlopeSpotOptions): SlopeSample | null => {
  const { minDeg, maxDeg, radius = 300, solid = true } = opts;
  const lo = (minDeg * Math.PI) / 180;
  const hi = (maxDeg * Math.PI) / 180;
  const s = VERTEX_SPACING;
  const origin = snapToVertex(cx, cz);
  const inRange = (a: number) => a >= lo && a <= hi;
  const n = Math.floor(radius / s);
  // Spiral outward so the nearest qualifying spot wins.
  for (let ring = 0; ring <= n; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (let j = -ring; j <= ring; j++) {
        if (Math.abs(i) !== ring && Math.abs(j) !== ring) continue;
        const x = origin.x + i * s;
        const z = origin.z + j * s;
        const raw = slopeAt(x, z, computeVertexDataRaw);
        if (!inRange(raw.angle)) continue;
        if (solid) {
          let ok = true;
          for (let a = -1; a <= 1 && ok; a++)
            for (let b = -1; b <= 1 && ok; b++) if (!inRange(slopeAt(x + a * s, z + b * s, computeVertexDataRaw).angle)) ok = false;
          if (!ok) continue;
        }
        const padded = slopeAt(x, z);
        if (!inRange(padded.angle)) continue;
        if (solid) {
          let ok = true;
          for (let a = -1; a <= 1 && ok; a++)
            for (let b = -1; b <= 1 && ok; b++) if (!inRange(slopeAt(x + a * s, z + b * s).angle)) ok = false;
          if (!ok) continue;
        }
        return padded;
      }
    }
  }
  return null;
};

export const deg = (rad: number): string => ((rad * 180) / Math.PI).toFixed(1) + "°";
