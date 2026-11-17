import { smoothstep } from "../../../utils/math";
import { RIVER_BED_FAR } from "../../../world/shaders/constants";
import { snowBiomeIds } from "../../snow/params";
import { snowCoverOf, terrainSnowDepthFrom } from "../../snow";
import { BIOME_SDF_FAR } from "../../zones/constants";
import { computeVertexData, getBiomeSlots } from "../..";
import { PATCH_ROCK_FADE } from "./constants";
import { drawnGroundAt, drawnNormalAt } from "../../drawn-ground";
import type { EntrancePatch, Bounds3 } from "../types";
import { BRICK, VOXEL } from "../constants";
import type { FieldFn } from "../field/types";

/**
 * The ENTRANCE PATCH's buffers: every nets triangle inside a mouth's footprint, ground and walls as one
 * surface, drawn by the terrain's own program (its ENTRANCE variant). So each vertex carries what the
 * terrain worker gives a terrain vertex — the biome slots, the riverbed, the roads, and the water depth
 * or MINUS the snow depth in one attribute (world/terrain/chunk/geometry.ts) — plus `entranceRock`: the
 * rock share (0 on the drawn ground, 1 by PATCH_ROCK_FADE under it) and the daylight. Three-free.
 */

/** The terrain program's biome slots: two vec4 attributes each (world/terrain/material.ts MAX_BIOME_SLOTS). */
const SLOTS = 8;

/** A patch vertex: absolute position, its normal (the drawn ground's on the ground), its daylight. */
export interface PatchVertex {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  light: number;
}

/** The patch from its vertices and triangles; positions relative to (centerX, 0, centerZ) like the walls. */
export const buildPatch = (vertices: readonly PatchVertex[], indices: readonly number[], centerX: number, centerZ: number): EntrancePatch => {
  const n = vertices.length;
  const slots = getBiomeSlots().length;
  const snow = snowBiomeIds().length > 0;
  const patch: EntrancePatch = {
    positions: new Float32Array(n * 3),
    normals: new Float32Array(n * 3),
    indices: new Uint32Array(indices),
    biomeSdf0: new Float32Array(n * 4),
    biomeSdf1: new Float32Array(n * 4),
    biomePresence0: new Float32Array(n * 4),
    biomePresence1: new Float32Array(n * 4),
    riverbedSdf0: new Float32Array(n * 4),
    riverbedSdf1: new Float32Array(n * 4),
    riverBedDistance: new Float32Array(n),
    distanceToRoadCenter: new Float32Array(n),
    distanceToFreewayCenter: new Float32Array(n),
    freewayAlong: new Float32Array(n),
    underwaterDepth: new Float32Array(n),
    entranceRock: new Float32Array(n * 2),
  };
  for (let i = 0; i < n; i++) {
    const v = vertices[i];
    patch.positions[i * 3] = v.x - centerX;
    patch.positions[i * 3 + 1] = v.y;
    patch.positions[i * 3 + 2] = v.z - centerZ;
    patch.normals[i * 3] = v.nx;
    patch.normals[i * 3 + 1] = v.ny;
    patch.normals[i * 3 + 2] = v.nz;
    patch.entranceRock[i * 2] = smoothstep(0, PATCH_ROCK_FADE, drawnGroundAt(v.x, v.z) - v.y);
    patch.entranceRock[i * 2 + 1] = v.light;
    // The scratch buffers of this result are overwritten by the next call (and by the snow's reads):
    // everything is copied out first.
    const vd = computeVertexData(v.x, v.z);
    for (let s = 0; s < SLOTS; s++) {
      const sdf = s < slots ? vd.biomeSdf[s] : -BIOME_SDF_FAR;
      const presence = s < slots ? vd.biomePresence[s] : -BIOME_SDF_FAR;
      const bed = s < slots ? vd.riverbedSdf[s] : -BIOME_SDF_FAR;
      const o = i * 4 + (s & 3);
      if (s < 4) {
        patch.biomeSdf0[o] = sdf;
        patch.biomePresence0[o] = presence;
        patch.riverbedSdf0[o] = bed;
      } else {
        patch.biomeSdf1[o] = sdf;
        patch.biomePresence1[o] = presence;
        patch.riverbedSdf1[o] = bed;
      }
    }
    patch.riverBedDistance[i] = Math.min(vd.riverBedDistance, RIVER_BED_FAR);
    patch.distanceToRoadCenter[i] = vd.distanceToRoadCenter;
    patch.distanceToFreewayCenter[i] = vd.distanceToFreewayCenter;
    patch.freewayAlong[i] = vd.freewayAlong;
    const waterDepth = vd.waterDepth;
    const height = vd.height;
    const cover = snow ? snowCoverOf(vd) : 0;
    if (waterDepth > 0) patch.underwaterDepth[i] = waterDepth;
    else if (cover > 0) {
      const ny = drawnNormalAt(v.x, v.z).y;
      patch.underwaterDepth[i] = -terrainSnowDepthFrom(v.x, v.z, height, cover, (Math.acos(Math.min(1, ny)) * 180) / Math.PI);
    }
  }
  return patch;
};

/**
 * SURFACE NETS over the caves' field, one BRICK (16³ voxels) at a time: a vertex per cell the surface
 * crosses (the mean of its edges' crossings), a quad per crossed grid edge joining the four cells around
 * it, wound to face the air. A brick owns the edges whose lower end lies in it and samples one voxel
 * below its lower faces for the cells there, so the bricks of a chunk (sharing their vertices through
 * NetVertices) and two chunks either side of a border (computing the same cells from the same field)
 * close without a crack. Three-free.
 */

export interface NetsOutput {
  positions: number[];
  normals: number[];
  indices: number[];
}

export interface BrickOptions {
  /** The drawn ground: the field becomes min(air, ground − y), "air above the ground OR in the tunnel". */
  ground?: (x: number, z: number) => number;
  /** Whether a box is provably rock: blocks of samples (padded by a voxel) it settles are not sampled. */
  rockBox?: (box: Bounds3) => boolean;
}

/** The voxels per brick side, and the samples per side: one below the brick and its upper face. */
const CELLS = BRICK / VOXEL;
const SIDE = CELLS + 2;
/** Samples are settled in blocks of this many per side. */
const BLOCK = 4;
/** What a settled sample holds: rock. Every cell touching it is rock at all eight corners (the block was
 *  proved rock a voxel past its samples), so the value is only ever sign-tested. */
const SETTLED = 1;
/** The gradient's step for a vertex's normal (half a voxel: the walls are shaded by it). */
const NORMAL_STEP = 0.5;

/** The nets' vertices of one chunk, shared by its bricks: a cell two bricks mesh is ONE vertex. */
export class NetVertices {
  private readonly ids = new Map<number, number>();

  /** The chunk's corner (any fixed point near it): cells are keyed relative to it. */
  constructor(
    readonly originX: number,
    readonly originZ: number,
  ) {}

  private key(i: number, j: number, k: number): number {
    return ((j + 32768) * 1024 + (i - Math.round(this.originX / VOXEL) + 256)) * 1024 + (k - Math.round(this.originZ / VOXEL) + 256);
  }

  get(i: number, j: number, k: number): number | undefined {
    return this.ids.get(this.key(i, j, k));
  }

  set(i: number, j: number, k: number, id: number): void {
    this.ids.set(this.key(i, j, k), id);
  }
}

// The cube's 12 edges as corner pairs; corner c has offsets (c & 1, (c >> 1) & 1, (c >> 2) & 1) in (x, y, z).
const EDGES: readonly [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/** Meshes the brick with its lowest corner at (x0, y0, z0) into `out`. */
export const meshBrick = (field: FieldFn, x0: number, y0: number, z0: number, shared: NetVertices, out: NetsOutput, options: BrickOptions = {}): void => {
  const { ground, rockBox } = options;
  const at = (i: number): number => (i - 1) * VOXEL;
  const index = (i: number, j: number, k: number): number => (i * SIDE + k) * SIDE + j;
  const values = new Float64Array(SIDE * SIDE * SIDE);
  const settled = new Uint8Array(SIDE * SIDE * SIDE);

  if (rockBox) {
    for (let bi = 0; bi < SIDE; bi += BLOCK) {
      for (let bk = 0; bk < SIDE; bk += BLOCK) {
        for (let bj = 0; bj < SIDE; bj += BLOCK) {
          const ei = Math.min(bi + BLOCK, SIDE) - 1;
          const ek = Math.min(bk + BLOCK, SIDE) - 1;
          const ej = Math.min(bj + BLOCK, SIDE) - 1;
          const box: Bounds3 = {
            minX: x0 + at(bi) - VOXEL,
            minY: y0 + at(bj) - VOXEL,
            minZ: z0 + at(bk) - VOXEL,
            maxX: x0 + at(ei) + VOXEL,
            maxY: y0 + at(ej) + VOXEL,
            maxZ: z0 + at(ek) + VOXEL,
          };
          if (!rockBox(box)) continue;
          for (let i = bi; i <= ei; i++) for (let k = bk; k <= ek; k++) for (let j = bj; j <= ej; j++) settled[index(i, j, k)] = 1;
        }
      }
    }
  }

  // y innermost: the ground is read once per column.
  for (let i = 0; i < SIDE; i++) {
    const x = x0 + at(i);
    for (let k = 0; k < SIDE; k++) {
      const z = z0 + at(k);
      const g = ground ? ground(x, z) : Infinity;
      for (let j = 0; j < SIDE; j++) {
        const n = index(i, j, k);
        if (settled[n]) {
          values[n] = SETTLED;
          continue;
        }
        const y = y0 + at(j);
        const v = field(x, y, z);
        const above = g - y;
        values[n] = above < v ? above : v;
      }
    }
  }

  const full: FieldFn = ground
    ? (x, y, z) => {
        const v = field(x, y, z);
        const above = ground(x, z) - y;
        return above < v ? above : v;
      }
    : field;
  const ci0 = Math.round(x0 / VOXEL) - 1;
  const cj0 = Math.round(y0 / VOXEL) - 1;
  const ck0 = Math.round(z0 / VOXEL) - 1;

  /** The vertex of the cell whose lowest corner is sample (i, j, k). */
  const vertexOf = (i: number, j: number, k: number): number => {
    const known = shared.get(ci0 + i, cj0 + j, ck0 + k);
    if (known !== undefined) return known;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (const [c0, c1] of EDGES) {
      const v0 = values[index(i + (c0 & 1), j + ((c0 >> 1) & 1), k + ((c0 >> 2) & 1))];
      const v1 = values[index(i + (c1 & 1), j + ((c1 >> 1) & 1), k + ((c1 >> 2) & 1))];
      if (v0 < 0 === v1 < 0) continue;
      const t = v0 / (v0 - v1);
      sx += (c0 & 1) + ((c1 & 1) - (c0 & 1)) * t;
      sy += ((c0 >> 1) & 1) + (((c1 >> 1) & 1) - ((c0 >> 1) & 1)) * t;
      sz += ((c0 >> 2) & 1) + (((c1 >> 2) & 1) - ((c0 >> 2) & 1)) * t;
      count++;
    }
    const x = x0 + at(i) + (sx / count) * VOXEL;
    const y = y0 + at(j) + (sy / count) * VOXEL;
    const z = z0 + at(k) + (sz / count) * VOXEL;
    // The normal faces the air: down the field's gradient.
    const h = NORMAL_STEP;
    let nx = full(x - h, y, z) - full(x + h, y, z);
    let ny = full(x, y - h, z) - full(x, y + h, z);
    let nz = full(x, y, z - h) - full(x, y, z + h);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    const id = out.positions.length / 3;
    out.positions.push(x, y, z);
    out.normals.push(nx, ny, nz);
    shared.set(ci0 + i, cj0 + j, ck0 + k, id);
    return id;
  };

  /** A quad of four cells around a crossed edge, (q0 q1 q2 q3) counter-clockwise about the edge's axis;
   *  reversed when the edge's lower end is the air, so it faces the air. */
  const quad = (lowerAir: boolean, a: number, b: number, c: number, d: number): void => {
    if (lowerAir) out.indices.push(a, d, c, a, c, b);
    else out.indices.push(a, b, c, a, c, d);
  };

  // The owned edges: lower end at samples 1..CELLS on every axis.
  for (let i = 1; i <= CELLS; i++) {
    for (let k = 1; k <= CELLS; k++) {
      for (let j = 1; j <= CELLS; j++) {
        const v = values[index(i, j, k)];
        const air = v < 0;
        // Along x: the cells around it step in y, then z.
        if (values[index(i + 1, j, k)] < 0 !== air) quad(air, vertexOf(i, j - 1, k - 1), vertexOf(i, j, k - 1), vertexOf(i, j, k), vertexOf(i, j - 1, k));
        // Along y: in z, then x.
        if (values[index(i, j + 1, k)] < 0 !== air) quad(air, vertexOf(i - 1, j, k - 1), vertexOf(i - 1, j, k), vertexOf(i, j, k), vertexOf(i, j, k - 1));
        // Along z: in x, then y.
        if (values[index(i, j, k + 1)] < 0 !== air) quad(air, vertexOf(i - 1, j - 1, k), vertexOf(i, j - 1, k), vertexOf(i, j, k), vertexOf(i - 1, j, k));
      }
    }
  }
};
