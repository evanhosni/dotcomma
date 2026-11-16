/**
 * A CAVE chunk (per 256u streaming chunk and biome): the systems in reach meshed by surface nets, a
 * 16u column of bricks at a time. Near a mouth (a FOOT column) the field takes the drawn ground in —
 * "air above the drawn ground OR in the tunnel" — so the entrance is ONE surface: ground vertices are
 * snapped onto the drawn ground with its normals, every triangle inside a footprint is the PATCH (the
 * terrain's program draws it), the walls are the rest. Colliders: the drawn walls and the whole patch,
 * per column. Positions relative to the chunk's center in x/z, absolute in y. Three-free.
 */

import type { RectXZ } from "../../math/types";
import { BRICK, FIELD_REACH, VOXEL } from "./constants";
import { ChunkAssembly, daylightAt, masksTouching, mouthDaylight, type DaylightSource, type Vertex } from "./assembly";
import { drawnGroundAt, drawnGroundMinOver, drawnNormalAt, LATTICE, latticeHeightAt } from "./drawnGround";
import { buildPatch, type PatchVertex } from "./entrance";
import { meshBrick, NetVertices, type NetsOutput } from "./surfaceNets";
import { systemsNear } from "./systems";
import { airMayReach, boundsTouchXZ, boxIsRock, compileField, insideMouthFootprint, mouthFootprintRadius, mouthSectionDistanceToRect, piecesTouching, rockDipOf, type FieldFn } from "./tunnelField";
import type { Bounds3, MouthPiece, SkirtMask, TunnelPiece, UndergroundChunk } from "./types";

/** The sound all-rock tests (tunnelField.ts boxIsRock); off only to pin that they change no bit (the test). */
let rockTestEnabled = true;
export const setRockTestEnabled = (enabled: boolean): void => {
  rockTestEnabled = enabled;
};

/** A column is a FOOT column when its samples come this close to a footprint: the ground term ends at
 *  foot columns' edges, so where it ends (a curtain over the ground, snapped flat and dropped) lies
 *  outside every footprint. */
const FOOT_MARGIN = 2;

/** The lowest and highest lattice heights over a square (every lattice point of the cells it touches). */
const groundRangeOver = (minX: number, minZ: number, maxX: number, maxZ: number): { min: number; max: number } => {
  let min = Infinity;
  let max = -Infinity;
  for (let m = Math.floor(minX / LATTICE); m <= Math.floor(maxX / LATTICE) + 1; m++) {
    for (let n = Math.floor(minZ / LATTICE); n <= Math.floor(maxZ / LATTICE) + 1; n++) {
      const h = latticeHeightAt(m, n);
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  return { min, max };
};

/** The square a column's samples cover: one voxel past its lower faces. */
const columnRect = (x0: number, z0: number): RectXZ => ({ minX: x0 - VOXEL, minZ: z0 - VOXEL, maxX: x0 + BRICK, maxZ: z0 + BRICK });

/** Meshes one BRICK-wide column: every brick the pieces' air can reach that is not provably rock, and in
 *  a foot column every brick the drawn ground crosses. */
const meshColumn = (x0: number, z0: number, pieces: readonly TunnelPiece[], dip: number, foot: boolean, shared: NetVertices, nets: NetsOutput): void => {
  const rect = columnRect(x0, z0);
  const columnPieces = pieces.filter((p) => boundsTouchXZ(p.bounds, rect.minX, rect.minZ, rect.maxX, rect.maxZ, FIELD_REACH));
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of columnPieces) {
    if (p.kind === "cone" || !boundsTouchXZ(p.bounds, rect.minX, rect.minZ, rect.maxX, rect.maxZ)) continue;
    lo = Math.min(lo, p.bounds.minY);
    hi = Math.max(hi, p.bounds.maxY);
  }
  const ground = foot ? groundRangeOver(rect.minX, rect.minZ, rect.maxX, rect.maxZ) : null;
  if (ground) {
    lo = Math.min(lo, ground.min - VOXEL);
    hi = Math.max(hi, ground.max + VOXEL);
  }
  if (lo > hi) return;
  for (let y0 = Math.floor(lo / BRICK) * BRICK; y0 - VOXEL <= hi; y0 += BRICK) {
    const box: Bounds3 = { minX: rect.minX, minY: y0 - VOXEL, minZ: rect.minZ, maxX: rect.maxX, maxY: y0 + BRICK, maxZ: rect.maxZ };
    // All air over the ground: no surface. Deeper than FIELD_REACH under its lowest point, the ground
    // term cannot win (the field never exceeds FIELD_REACH): the tunnel field alone, bit for bit.
    if (ground && box.minY > ground.max) continue;
    const groundTerm = ground !== null && box.maxY >= ground.min - FIELD_REACH;
    const brickPieces = piecesTouching(columnPieces, box);
    if (!groundTerm && (!airMayReach(brickPieces, box) || (rockTestEnabled && boxIsRock(brickPieces, box, dip)))) continue;
    meshBrick(compileField(brickPieces), x0, y0, z0, shared, nets, {
      ground: groundTerm ? drawnGroundAt : undefined,
      rockBox: rockTestEnabled ? (b) => boxIsRock(brickPieces, b, dip) && (!groundTerm || drawnGroundMinOver(b.minX, b.minZ, b.maxX, b.maxZ) > b.maxY) : undefined,
    });
  }
};

/** Whether a column is a foot column: a footprint (plus FOOT_MARGIN) reaches its samples. */
const isFoot = (mouths: readonly MouthPiece[], x0: number, z0: number): boolean =>
  mouths.some((m) => mouthSectionDistanceToRect(m, columnRect(x0, z0)) < mouthFootprintRadius(m) + FOOT_MARGIN);

/** The finished nets vertices: a GROUND vertex (in a foot column, where the ground term wins the field)
 *  is snapped onto the drawn ground and takes the terrain's normal; every vertex gets its daylight. */
const finishVertices = (nets: NetsOutput, all: FieldFn, mouths: readonly MouthPiece[], minX: number, minZ: number, lights: readonly DaylightSource[]): { vertices: Vertex[]; ground: Uint8Array } => {
  const count = nets.positions.length / 3;
  const vertices: Vertex[] = new Array(count);
  const ground = new Uint8Array(count);
  const feet = new Map<number, boolean>();
  const footAt = (x: number, z: number): boolean => {
    const cx = minX + Math.floor((x - minX) / BRICK) * BRICK;
    const cz = minZ + Math.floor((z - minZ) / BRICK) * BRICK;
    const key = (cx / BRICK) * 1e7 + cz / BRICK;
    let foot = feet.get(key);
    if (foot === undefined) feet.set(key, (foot = isFoot(mouths, cx, cz)));
    return foot;
  };
  for (let i = 0; i < count; i++) {
    const x = nets.positions[i * 3];
    let y = nets.positions[i * 3 + 1];
    const z = nets.positions[i * 3 + 2];
    let nx = nets.normals[i * 3];
    let ny = nets.normals[i * 3 + 1];
    let nz = nets.normals[i * 3 + 2];
    // A column's bricks also mesh the cells one voxel below its lower faces: a vertex there may be its.
    if (footAt(x, z) || footAt(x + VOXEL, z) || footAt(x, z + VOXEL) || footAt(x + VOXEL, z + VOXEL)) {
      const g = drawnGroundAt(x, z);
      if (g - y < all(x, y, z)) {
        ground[i] = 1;
        y = g;
        const n = drawnNormalAt(x, z);
        nx = n.x;
        ny = n.y;
        nz = n.z;
      }
    }
    vertices[i] = { x, y, z, nx, ny, nz, r: 0, g: 0, b: 0, light: daylightAt(lights, x, y, z) };
  }
  return { vertices, ground };
};

export const buildCaveChunk = (b: RectXZ, biomeId: number): UndergroundChunk | null => {
  const systems = systemsNear("cave", biomeId, b, FIELD_REACH + BRICK);
  if (systems.length === 0) return null;
  const all: TunnelPiece[] = [];
  const mouths: MouthPiece[] = [];
  const masks: SkirtMask[] = [];
  for (const s of systems) {
    all.push(...s.pieces);
    mouths.push(...s.mouths);
    masks.push(...s.masks);
  }
  const pieces = all.filter((p) => boundsTouchXZ(p.bounds, b.minX, b.minZ, b.maxX, b.maxZ, FIELD_REACH));
  const footMouths = mouths.filter((m) => mouthSectionDistanceToRect(m, { minX: b.minX - BRICK, minZ: b.minZ - BRICK, maxX: b.maxX + BRICK, maxZ: b.maxZ + BRICK }) < mouthFootprintRadius(m) + FOOT_MARGIN);
  if (pieces.length === 0 && footMouths.length === 0) return null;

  const shared = new NetVertices(b.minX, b.minZ);
  const nets: NetsOutput = { positions: [], normals: [], indices: [] };
  const dip = rockDipOf(pieces);
  for (let x0 = b.minX; x0 < b.maxX; x0 += BRICK) {
    for (let z0 = b.minZ; z0 < b.maxZ; z0 += BRICK) meshColumn(x0, z0, pieces, dip, isFoot(footMouths, x0, z0), shared, nets);
  }

  const centerX = (b.minX + b.maxX) / 2;
  const centerZ = (b.minZ + b.maxZ) / 2;
  const { vertices, ground } = finishVertices(nets, compileField(pieces), footMouths, b.minX, b.minZ, mouths.map(mouthDaylight));
  const assembly = new ChunkAssembly(centerX, centerZ, b.minX, b.minZ, false);
  const patchIds = new Map<number, number>();
  const patchVertices: PatchVertex[] = [];
  const patchIndices: number[] = [];
  const patchVertex = (id: number): number => {
    let index = patchIds.get(id);
    if (index === undefined) {
      index = patchVertices.length;
      const v = vertices[id];
      patchVertices.push({ x: v.x, y: v.y, z: v.z, nx: v.nx, ny: v.ny, nz: v.nz, light: v.light });
      patchIds.set(id, index);
    }
    return index;
  };
  const idx = nets.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const ia = idx[t];
    const ib = idx[t + 1];
    const ic = idx[t + 2];
    const cx = (vertices[ia].x + vertices[ib].x + vertices[ic].x) / 3;
    const cz = (vertices[ia].z + vertices[ib].z + vertices[ic].z) / 3;
    if (footMouths.some((m) => insideMouthFootprint(m, cx, cz))) {
      // The patch: drawn by the terrain's program, and solid WHOLE (its ground too: in a mouth's cut the
      // heightfield is not ground, the patch is).
      patchIndices.push(patchVertex(ia), patchVertex(ib), patchVertex(ic));
      assembly.collideShared(vertices, ia, ib, ic);
    } else if (!(ground[ia] && ground[ib] && ground[ic])) {
      assembly.triangleShared(vertices, ia, ib, ic);
    }
  }

  return {
    style: "cave",
    centerX,
    centerZ,
    pieces,
    entrances: [],
    systemEntrances: [],
    mouths,
    masks: masksTouching(masks, b),
    mesh: assembly.mesh(),
    colliders: assembly.colliders(),
    liquid: null,
    patch: patchIndices.length > 0 ? buildPatch(patchVertices, patchIndices, centerX, centerZ) : null,
    doors: [],
    caps: [],
  };
};
