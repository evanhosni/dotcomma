import { DRESSING_COLLIDER_SPECS, runDressingEnumerator } from "../../../../src/objects/dressing/registry";
import { WORLD_CHUNK_SIZE } from "../../../../src/objects/dressing/types";
import type { ObstaclePoint, TunnelPart } from "./types";
import { computeVertexData } from "../../../../src/generation";
import { TERRAIN_CHUNK_SIZE, TERRAIN_ROWS, TERRAIN_SEGMENTS, TERRAIN_VERTEX_SPACING } from "./constants";
import { caveBiomeIds, sewerBiomeIds } from "../../../../src/generation/underground/params";
import { buildUndergroundChunk } from "../../../../src/generation/underground/chunks";
import type { UndergroundChunk } from "../../../../src/generation/underground/types";

/** The body's own chunk plus the neighbor across any edge within `margin` (a 2×2 at a corner). */
export const chunkIndicesNear = (x: number, z: number, size: number, margin: number): [number, number][] => {
  const gx = Math.floor(x / size);
  const gz = Math.floor(z / size);
  const fx = x - gx * size;
  const fz = z - gz * size;
  const xs = [gx];
  if (fx < margin) xs.push(gx - 1);
  else if (size - fx < margin) xs.push(gx + 1);
  const zs = [gz];
  if (fz < margin) zs.push(gz - 1);
  else if (size - fz < margin) zs.push(gz + 1);
  const out: [number, number][] = [];
  for (const a of xs) for (const b of zs) out.push([a, b]);
  return out;
};

/**
 * Every collider-bearing dressing feature (objects/dressing/registry.ts) as plain data: each spec's
 * enumerator run with its spec placement, each point through its spec's bodiesOf. Rapier-free, so
 * the generation worker can run it. Chunk size MUST stay WORLD_CHUNK_SIZE: belt-freeway pole and
 * bridge coverage depend on the query center's wall set.
 */

export const dressingChunkBounds = (gx: number, gz: number) => ({
  minX: gx * WORLD_CHUNK_SIZE,
  minZ: gz * WORLD_CHUNK_SIZE,
  maxX: (gx + 1) * WORLD_CHUNK_SIZE,
  maxZ: (gz + 1) * WORLD_CHUNK_SIZE,
});

export const enumerateObstacles = (gx: number, gz: number): ObstaclePoint[] => {
  const bounds = dressingChunkBounds(gx, gz);
  const out: ObstaclePoint[] = [];
  for (const spec of DRESSING_COLLIDER_SPECS) {
    for (const point of runDressingEnumerator(spec.enumerator, bounds, spec.placement)) {
      for (const body of spec.bodiesOf(point)) out.push({ ...body, parts: body.parts ?? spec.colliderParts });
    }
  }
  return out;
};

/**
 * The client's LOD1 collider EXACTLY (world/terrain/terrain.worker.ts → generateColliders):
 * same fround'd local grid, same PlaneGeometry z-flip, same column-major
 * layout, body at the chunk CENTER — bit-identical ground to the player's.
 * Only LOD1: the resolution the player stands on and the slope tuning was
 * measured at. Rapier-free, so the generation worker runs it.
 */

const HALF = TERRAIN_CHUNK_SIZE / 2;

export const chunkIndex = (v: number): number => Math.floor(v / TERRAIN_CHUNK_SIZE);
export const chunkCenter = (g: number): number => g * TERRAIN_CHUNK_SIZE + HALF;

// fround keeps heights bit-identical to the float32 positions the client samples.
const localX = new Float64Array(TERRAIN_ROWS);
const localY = new Float64Array(TERRAIN_ROWS);
for (let i = 0; i < TERRAIN_ROWS; i++) {
  localX[i] = Math.fround((i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE - HALF);
  localY[i] = Math.fround(-(i / TERRAIN_SEGMENTS) * TERRAIN_CHUNK_SIZE + HALF);
}

export const vertexWorld = (gx: number, gz: number, ix: number, iz: number): { x: number; z: number } => ({
  x: chunkCenter(gx) + localX[ix],
  z: chunkCenter(gz) - localY[iz],
});

/** The collider surface is exact at a vertex. */
export const snapToVertex = (x: number, z: number): { x: number; z: number } => ({
  x: Math.round(x / TERRAIN_VERTEX_SPACING) * TERRAIN_VERTEX_SPACING,
  z: Math.round(z / TERRAIN_VERTEX_SPACING) * TERRAIN_VERTEX_SPACING,
});

/** Column-major, exactly what the client's terrain worker hands generateColliders. */
export const sampleChunkHeights = (gx: number, gz: number): Float32Array => {
  const heights = new Float32Array(TERRAIN_ROWS * TERRAIN_ROWS);
  for (let iz = 0; iz < TERRAIN_ROWS; iz++) sampleChunkRow(gx, gz, iz, heights);
  return heights;
};

export const sampleChunkRow = (gx: number, gz: number, iz: number, heights: Float32Array): void => {
  const cx = chunkCenter(gx);
  const wz = -localY[iz] + chunkCenter(gz);
  for (let ix = 0; ix < TERRAIN_ROWS; ix++) {
    heights[ix * TERRAIN_ROWS + iz] = computeVertexData(localX[ix] + cx, wz).height;
  }
};

/**
 * The tunnels an NPC moves through: per dressing chunk, every tunnel style under every biome that holds
 * one, built by the client's own chunk builder (generation/underground/chunks/index.ts) and kept as what
 * a body needs — the probe's pieces and entrances, the liquid, and the colliders (the brick columns plus
 * the ladders and closed doors: generation/underground/chunks/spec.ts). Rapier-free: the generation worker runs it.
 */

export const sampleTunnelChunk = (gx: number, gz: number): TunnelPart[] => {
  const bounds = dressingChunkBounds(gx, gz);
  const out: TunnelPart[] = [];
  const add = (chunk: UndergroundChunk | null): void => {
    if (!chunk) return;
    const { style, centerX, centerZ, pieces, systemEntrances, liquid, colliders, entrances, doors } = chunk;
    out.push({ style, centerX, centerZ, pieces, systemEntrances, liquid, colliders, entrances, doors });
  };
  for (const id of sewerBiomeIds()) add(buildUndergroundChunk(bounds, "sewer", id));
  for (const id of caveBiomeIds()) add(buildUndergroundChunk(bounds, "cave", id));
  return out;
};
