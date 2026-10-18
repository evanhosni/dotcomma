/**
 * SNOW over `snow: true` biomes: where it lies and how deep (one rule for the near sheet, the
 * terrain's whitening at every LOD and the wading speed), the near sheet per dressing chunk, and the
 * speed factor every capsule pays. Three-free (the server's NPCs wade too).
 */

import { smoothstep } from "../../math/_math";
import { combineMovementModifiers, type MovementModifiers } from "../../../physics/movementModifiers";
import type { RectXZ } from "../../math/types";
import { caveBiomeIds, snowBiomeIds } from "../biomeFlags";
import { dropOldestHalf } from "../cellCache";
import { domainConfig } from "../computeConfig";
import { simplex2 } from "../noise";
import type { VertexResult } from "../types";
import { BULGE_MAX_REACH } from "../underground/constants";
import { drawnGroundAt, LATTICE, latticeHeightAt, latticeKey } from "../underground/drawnGround";
import { caveKeepOffFade, keepOffRadius, mouthsNear } from "../underground/mouthBulge";
import { caveMouthsNear } from "../underground/systems";
import { mouthSectionDistanceToRect } from "../underground/tunnelField";
import type { MouthPiece } from "../underground/types";
import { biomeWeightOf, computeVertexData, riverKeepOff } from "../vertexCompute";

/** No snow below the line's foot, full by its top (ground height). */
const SNOW_LINE_LOW = 40;
const SNOW_LINE_HIGH = 100;
/** Altitude: 0 at the low height, 1 by the high one. */
const ALTITUDE_LOW = 20;
const ALTITUDE_HIGH = 250;
/** The slope limit (degrees) and how much higher ground raises it; the pile's edge softens over ±SLOPE_SOFT. */
const SLOPE_LIMIT = 40;
const SLOPE_LIMIT_ALTITUDE = 15;
const SLOPE_SOFT = 6;
/** The terrain's own snow reaches this much steeper than the piles, softened over ±GROUND_SLOPE_SOFT. */
const GROUND_SLOPE_EXTRA = 15;
const GROUND_SLOPE_SOFT = 16;
/** The amount's threshold; the ground's own snow begins GROUND_AMOUNT_PAST of amount past the piles' edge
 *  and is whole GROUND_AMOUNT_FADE of amount past its own (fading into the rock gradually). */
const AMOUNT_OFFSET = 0.32;
const GROUND_AMOUNT_PAST = 0.08;
const GROUND_AMOUNT_FADE = 0.3;
/** The ground's own snow (0–1) as a depth: the terrain shows its snow whole by this much depth
 *  (world/shaders/combineBiomeMaterials.ts GROUND_SNOW_GLSL). */
const GROUND_DEPTH_SHARE = 0.35;
const SNOW_DEPTH_MAX = 1.85;
/** The pile rises over a quarter-circle edge over this much amount. */
const EDGE_AMOUNT = 0.18;
/** Cover fades in over this past a road's, freeway's or river's keep-off. */
const KEEP_OFF_FADE = 4;
/** Water: no snow under it or within this of its surface. */
const WATER_CLEAR = 0.3;
/** Wading: speed × max(SPEED_FLOOR, 1 − SPEED_PER_DEPTH × depth) — the deepest pile (1.85u) is a
 *  quarter of the walk; and TRACTION: every slope limit rises SLOPE_BONUS_PER_DEPTH per unit of depth, up
 *  to SLOPE_BONUS_MAX (deep snow packs under the feet; the slide angle 40° → 52°). Both grow with the depth. */
const SPEED_PER_DEPTH = 0.42;
const SPEED_FLOOR = 0.25;
const SLOPE_BONUS_PER_DEPTH = 8 * (Math.PI / 180);
const SLOPE_BONUS_MAX = 12 * (Math.PI / 180);
/** The sheet's grid, and how far the cut edge sits under the ground. */
const SNOW_GRID = 2;
const EDGE_SINK = 0.05;

/** A smooth 0–1 world field (~50–90u). */
const snowDrift = (x: number, z: number): number => 0.5 + 0.5 * (0.6 * simplex2(x / 70, z / 70) + 0.4 * simplex2(x / 90 + 7.3, z / 50 - 2.1));
/** A −1..1 field (~6–9u). */
const snowLumps = (x: number, z: number): number => simplex2(x / 7.5 + 3.1, z / 7.5 - 5.7);

const altitudeOf = (height: number): number => smoothstep(ALTITUDE_LOW, ALTITUDE_HIGH, height);

/** The snow biomes' share of the terrain at a vertex: 0 under or near water, under a deck, fading in
 *  over KEEP_OFF_FADE past a road's, freeway's or river's keep-off. */
export const snowCoverOf = (vd: VertexResult): number => {
  const ids = snowBiomeIds();
  if (ids.length === 0) return 0;
  let cover = biomeWeightOf(vd.biomeSdf, ids);
  if (cover <= 0) return 0;
  if (vd.waterHeight > vd.height - WATER_CLEAR || vd.underDeck > 0) return 0;
  const city = domainConfig!.cityConfig;
  cover *= smoothstep(city.roadWidth, city.roadWidth + KEEP_OFF_FADE, vd.distanceToRoadCenter);
  cover *= smoothstep(city.freewayWidth, city.freewayWidth + KEEP_OFF_FADE, vd.distanceToFreewayCenter);
  cover *= smoothstep(riverKeepOff(), riverKeepOff() + KEEP_OFF_FADE, vd.distanceToRiverCenter);
  return cover;
};

/** Whether any snow can lie at a vertex: some cover, above the snow line's foot. Below either, every
 *  amount is −AMOUNT_OFFSET and every depth 0, before any noise is read. */
const snowCanLie = (height: number, cover: number): boolean => cover > 0 && smoothstep(SNOW_LINE_LOW, SNOW_LINE_HIGH, height) > 0;

// The drift and lump noises are the costly part of a vertex (three simplex2 per read), and the amount,
// the wide amount and the depth of one vertex read the same two: callers read them once and pass them
// down (terrain snow 238 → 85ns per vertex, DECISIONS.md).

/** The snow AMOUNT where snow can lie (positive where a pile lies); `slopeSoft` widens the slope edge. */
const amountFrom = (height: number, cover: number, slopeDeg: number, slopeExtra: number, slopeSoft: number, drift: number, lumps: number): number => {
  const line = smoothstep(SNOW_LINE_LOW, SNOW_LINE_HIGH, height);
  const altitude = altitudeOf(height);
  const limit = SLOPE_LIMIT + SLOPE_LIMIT_ALTITUDE * altitude + slopeExtra;
  const flatness = 1 - smoothstep(limit - slopeSoft, limit + slopeSoft, slopeDeg);
  return cover * line * (0.08 + 0.45 * drift + 0.65 * altitude + 0.12 * lumps) * flatness - AMOUNT_OFFSET;
};

/** A pile's depth where the amount is positive: a quarter-circle edge over the first EDGE_AMOUNT. */
const depthFrom = (amount: number, height: number, drift: number, lumps: number): number => {
  if (amount <= 0) return 0;
  const altitude = altitudeOf(height);
  const full = Math.min(SNOW_DEPTH_MAX, (0.6 + 0.8 * drift) * (1 + 0.5 * altitude) * (1 + 0.2 * lumps));
  const t = Math.min(1, amount / EDGE_AMOUNT);
  return full * Math.sqrt(1 - (1 - t) * (1 - t));
};

/** A pile's depth at a point from its cover and slope, the noises read once. */
const pileDepthFrom = (x: number, z: number, height: number, cover: number, slopeDeg: number): number => {
  if (!snowCanLie(height, cover)) return 0;
  const drift = snowDrift(x, z);
  const lumps = snowLumps(x, z);
  return depthFrom(amountFrom(height, cover, slopeDeg, 0, SLOPE_SOFT, drift, lumps), height, drift, lumps);
};

/** The terrain's own snow depth at a vertex (every LOD) from its height, cover and slope: the pile's,
 *  or the ground's wider snow at GROUND_DEPTH_SHARE of it. No cave keep-off. */
export const terrainSnowDepthFrom = (x: number, z: number, height: number, cover: number, slopeDeg: number): number => {
  if (!snowCanLie(height, cover)) return 0;
  const drift = snowDrift(x, z);
  const lumps = snowLumps(x, z);
  const pile = depthFrom(amountFrom(height, cover, slopeDeg, 0, SLOPE_SOFT, drift, lumps), height, drift, lumps);
  const wide = amountFrom(height, cover, slopeDeg, GROUND_SLOPE_EXTRA, GROUND_SLOPE_SOFT, drift, lumps);
  const ground = smoothstep(0, GROUND_AMOUNT_FADE, wide + GROUND_AMOUNT_PAST) * GROUND_DEPTH_SHARE;
  return Math.max(pile, ground);
};

export const terrainSnowDepth = (x: number, z: number, vd: VertexResult, slopeDeg: number): number =>
  terrainSnowDepthFrom(x, z, vd.height, snowCoverOf(vd), slopeDeg);

// ── The cover lattice (the near sheet and the wading read cover on the LOD1 lattice) ─────────

const COVER_CACHE_MAX = 1 << 16;
const coverLattice = new Map<number, number>();

export const clearSnowCaches = (): void => coverLattice.clear();

const coverAtLattice = (m: number, n: number): number => {
  const key = latticeKey(m, n);
  let c = coverLattice.get(key);
  if (c === undefined) {
    if (coverLattice.size >= COVER_CACHE_MAX) dropOldestHalf(coverLattice);
    c = snowCoverOf(computeVertexData(m * LATTICE, n * LATTICE));
    coverLattice.set(key, c);
  }
  return c;
};

/** Cover (bilinear) and the slope across the whole lattice cell holding a point. */
const latticeSample = (x: number, z: number): { cover: number; slope: number } => {
  const fx = x / LATTICE;
  const fz = z / LATTICE;
  const m = Math.floor(fx);
  const n = Math.floor(fz);
  const u = fx - m;
  const v = fz - n;
  const c00 = coverAtLattice(m, n);
  const c10 = coverAtLattice(m + 1, n);
  const c01 = coverAtLattice(m, n + 1);
  const c11 = coverAtLattice(m + 1, n + 1);
  const cover = (c00 * (1 - u) + c10 * u) * (1 - v) + (c01 * (1 - u) + c11 * u) * v;
  const h00 = latticeHeightAt(m, n);
  const h10 = latticeHeightAt(m + 1, n);
  const h01 = latticeHeightAt(m, n + 1);
  const h11 = latticeHeightAt(m + 1, n + 1);
  const dhdx = (h10 - h00 + h11 - h01) / (2 * LATTICE);
  const dhdz = (h01 - h00 + h11 - h10) / (2 * LATTICE);
  return { cover, slope: (Math.atan(Math.hypot(dhdx, dhdz)) * 180) / Math.PI };
};

/** The pile depth at a point on the drawn ground, as the sheet lays it (fading out into a cave mouth's keep-off). */
const pileDepthAt = (x: number, z: number): number => {
  const { cover, slope } = latticeSample(x, z);
  if (cover <= 0) return 0;
  const mouths = mouthsNear(x, z);
  const keepOff = mouths.length > 0 ? caveKeepOffFade(mouths, x, z, KEEP_OFF_FADE) : 1;
  if (keepOff <= 0) return 0;
  return pileDepthFrom(x, z, drawnGroundAt(x, z), cover * keepOff, slope);
};

/** A capsule whose feet stand farther than this from the drawn ground (in a tunnel under it, or in
 *  the air over it) is not in the snow on that ground. */
const SNOW_FEET_TOLERANCE = 1.5;

/** The snow's share of a capsule's movement modifiers at a point (physics/movementModifiers.ts): the
 *  pile's depth slows the walk and grips the slopes; folded into `out` (neutral off snow). `feetY`:
 *  the capsule's feet, so a walker in a cave under a snowy summit is not wading (NaN = on the ground). */
export const snowMovementAt = (x: number, z: number, out: MovementModifiers, feetY = NaN): MovementModifiers => {
  if (!domainConfig || snowBiomeIds().length === 0) return out;
  if (!Number.isNaN(feetY) && Math.abs(drawnGroundAt(x, z) - feetY) > SNOW_FEET_TOLERANCE) return out;
  const depth = pileDepthAt(x, z);
  if (depth <= 0) return out;
  out.snowDepth = Math.max(out.snowDepth, depth);
  combineMovementModifiers(out, Math.max(SPEED_FLOOR, 1 - SPEED_PER_DEPTH * depth), Math.min(SLOPE_BONUS_MAX, SLOPE_BONUS_PER_DEPTH * depth));
  return out;
};

// ── The near sheet ─────────────────────────────────────────────────────────

export interface SnowDriftMesh {
  /** The chunk's center; positions are relative to it in x/z, absolute in y. */
  x: number;
  z: number;
  positions: Float32Array;
  normals: Float32Array;
  depths: Float32Array;
  indices: Uint32Array;
}

/** The mouths whose keep-off can reach a chunk, seen from the chunk padded by its own size. */
const keepOffMouthsAround = (b: RectXZ, size: number): MouthPiece[] => {
  const ids = caveBiomeIds();
  if (ids.length === 0) return [];
  return caveMouthsNear(ids, b, BULGE_MAX_REACH).filter((m) => mouthSectionDistanceToRect(m, b) < keepOffRadius(m) + size);
};

/** The sheet's nodes: the chunk's SNOW_GRID grid plus one node of margin on every side (the normals),
 *  each with its drawn ground, amount and depth; `any` is whether a node of the chunk itself has snow. */
interface SheetNodes {
  /** Nodes per side, the margin included. */
  M: number;
  ground: Float64Array;
  amount: Float64Array;
  depth: Float64Array;
  any: boolean;
}

const sampleSheetNodes = (b: RectXZ, cells: number, mouths: readonly MouthPiece[]): SheetNodes => {
  const n = cells + 1;
  const M = n + 2;
  const ground = new Float64Array(M * M);
  const amount = new Float64Array(M * M);
  const depth = new Float64Array(M * M);
  let any = false;
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const x = b.minX + (i - 1) * SNOW_GRID;
      const z = b.minZ + (j - 1) * SNOW_GRID;
      const g = drawnGroundAt(x, z);
      const sample = latticeSample(x, z);
      const slope = sample.slope;
      // The cover fades out into a cave mouth's keep-off like past a road's, so the sheet's zero
      // crossing (its edge) runs smoothly around the opening instead of jumping node by node.
      const cover = sample.cover * (mouths.length > 0 ? caveKeepOffFade(mouths, x, z, KEEP_OFF_FADE) : 1);
      let a = -AMOUNT_OFFSET;
      let d = 0;
      if (snowCanLie(g, cover)) {
        const drift = snowDrift(x, z);
        const lumps = snowLumps(x, z);
        a = amountFrom(g, cover, slope, 0, SLOPE_SOFT, drift, lumps);
        d = depthFrom(a, g, drift, lumps);
      }
      const k = j * M + i;
      ground[k] = g;
      amount[k] = a;
      depth[k] = d;
      if (a > 0 && i >= 1 && i <= n && j >= 1 && j <= n) any = true;
    }
  }
  return { M, ground, amount, depth, any };
};

/** One continuous sheet per chunk on the SNOW_GRID grid over the drawn ground, cut along the smooth
 *  curve where the amount crosses zero (interpolated along edges, EDGE_SINK under the ground), smooth
 *  normals shared across chunk borders, fading out into a cave mouth's keep-off. Empty where no snow lies. */
export const getSnowDrift = (b: RectXZ): SnowDriftMesh[] => {
  if (snowBiomeIds().length === 0) return [];
  const size = b.maxX - b.minX;
  const cells = Math.round(size / SNOW_GRID);
  const { M, ground, amount, depth, any } = sampleSheetNodes(b, cells, keepOffMouthsAround(b, size));
  if (!any) return [];
  const surface = (k: number): number => ground[k] + depth[k];
  const normalAt = (i: number, j: number): [number, number, number] => {
    const k = j * M + i;
    const dx = (surface(k + 1) - surface(k - 1)) / (2 * SNOW_GRID);
    const dz = (surface(k + M) - surface(k - M)) / (2 * SNOW_GRID);
    const len = Math.hypot(dx, 1, dz);
    return [-dx / len, 1 / len, -dz / len];
  };
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const depths: number[] = [];
  const indices: number[] = [];
  const nodeVertex = new Map<number, number>();
  const edgeVertex = new Map<number, number>();
  const push = (x: number, y: number, z: number, nrm: [number, number, number], d: number): number => {
    positions.push(x - cx, y, z - cz);
    normals.push(nrm[0], nrm[1], nrm[2]);
    depths.push(d);
    return positions.length / 3 - 1;
  };
  const vertexOfNode = (i: number, j: number): number => {
    const key = j * M + i;
    let v = nodeVertex.get(key);
    if (v === undefined) {
      const x = b.minX + (i - 1) * SNOW_GRID;
      const z = b.minZ + (j - 1) * SNOW_GRID;
      v = push(x, surface(key), z, normalAt(i, j), depth[key]);
      nodeVertex.set(key, v);
    }
    return v;
  };
  /** The crossing on the edge between two nodes (the first inside): EDGE_SINK under the ground. */
  const vertexOfEdge = (i0: number, j0: number, i1: number, j1: number): number => {
    const k0 = j0 * M + i0;
    const k1 = j1 * M + i1;
    const key = Math.min(k0, k1) * (M * M) + Math.max(k0, k1);
    let v = edgeVertex.get(key);
    if (v === undefined) {
      const a0 = amount[k0];
      const a1 = amount[k1];
      const t = a0 / (a0 - a1);
      const x = b.minX + (i0 - 1 + (i1 - i0) * t) * SNOW_GRID;
      const z = b.minZ + (j0 - 1 + (j1 - j0) * t) * SNOW_GRID;
      const n0 = normalAt(i0, j0);
      const n1 = normalAt(i1, j1);
      const nx = n0[0] + (n1[0] - n0[0]) * t;
      const ny = n0[1] + (n1[1] - n0[1]) * t;
      const nz = n0[2] + (n1[2] - n0[2]) * t;
      const len = Math.hypot(nx, ny, nz) || 1;
      v = push(x, drawnGroundAt(x, z) - EDGE_SINK, z, [nx / len, ny / len, nz / len], 0);
      edgeVertex.set(key, v);
    }
    return v;
  };
  const emitTriangle = (tri: [number, number][]): void => {
    const inside = tri.map(([i, j]) => amount[j * M + i] > 0);
    const count = inside.filter(Boolean).length;
    if (count === 0) return;
    if (count === 3) {
      indices.push(vertexOfNode(tri[0][0], tri[0][1]), vertexOfNode(tri[1][0], tri[1][1]), vertexOfNode(tri[2][0], tri[2][1]));
      return;
    }
    // Rotate so the odd vertex comes first.
    let r = 0;
    while (inside[r] === (count === 2)) r++;
    const p = [tri[r], tri[(r + 1) % 3], tri[(r + 2) % 3]];
    if (count === 1) {
      const a = vertexOfNode(p[0][0], p[0][1]);
      const ab = vertexOfEdge(p[0][0], p[0][1], p[1][0], p[1][1]);
      const ac = vertexOfEdge(p[0][0], p[0][1], p[2][0], p[2][1]);
      indices.push(a, ab, ac);
    } else {
      const bv = vertexOfNode(p[1][0], p[1][1]);
      const cv = vertexOfNode(p[2][0], p[2][1]);
      const ba = vertexOfEdge(p[1][0], p[1][1], p[0][0], p[0][1]);
      const ca = vertexOfEdge(p[2][0], p[2][1], p[0][0], p[0][1]);
      indices.push(bv, cv, ca, bv, ca, ba);
    }
  };
  for (let j = 1; j <= cells; j++) {
    for (let i = 1; i <= cells; i++) {
      emitTriangle([
        [i, j],
        [i, j + 1],
        [i + 1, j],
      ]);
      emitTriangle([
        [i, j + 1],
        [i + 1, j + 1],
        [i + 1, j],
      ]);
    }
  }
  if (indices.length === 0) return [];
  return [{ x: cx, z: cz, positions: new Float32Array(positions), normals: new Float32Array(normals), depths: new Float32Array(depths), indices: new Uint32Array(indices) }];
};
