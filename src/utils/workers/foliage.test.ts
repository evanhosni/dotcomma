/** Foliage bands: a band is a strict prefix of the full fade-key order, so a chunk widened on
 *  approach adds exactly the blades fading in and never changes one it already holds. */
import { OVERWORLD_CONFIG } from "../../world/domains/overworld/config";
import { GRASS_BIOME } from "../../world/domains/overworld/regions/city/biomes/grass/spec";
import { generateChunk } from "./foliage.worker";
import { initCompute } from "./vertexCompute";

const GRASS = {
  seed: "grass",
  chunkSize: 64,
  density: 8_000_000,
  biomeIds: [GRASS_BIOME.id],
  slopeRange: [0, 28] as [number, number],
  slopeBlend: 12,
  roadDistanceRange: [8.5, 99999] as [number, number],
};

const bits = (a: Float32Array, n = a.length) => Array.from(new Uint32Array(a.buffer, a.byteOffset, n));

/** A grass-dense spot found by coarse scan; the chunks around it are mostly full of blades. */
const SPOT_CX = Math.floor(-1500 / 64);
const SPOT_CZ = Math.floor(-12000 / 64);

let chunks: [number, number][] = [];

beforeAll(() => {
  initCompute(OVERWORLD_CONFIG);
  for (let a = -3; a <= 3 && chunks.length < 3; a++)
    for (let b = -3; b <= 3 && chunks.length < 3; b += 3)
      if (generateChunk(SPOT_CX + a * 4, SPOT_CZ + b * 4, GRASS, 1).total > 1000) chunks.push([SPOT_CX + a * 4, SPOT_CZ + b * 4]);
});

test("the scan found grass chunks to test on", () => {
  expect(chunks.length).toBeGreaterThan(0);
});

test("a narrow band is exactly the leading blades of the full band", () => {
  for (const [cx, cz] of chunks) {
    const full = generateChunk(cx, cz, GRASS, 1);
    for (const band of [0.25, 0.5, 0.9]) {
      const part = generateChunk(cx, cz, GRASS, band);
      expect(part.total).toBe(full.total);
      expect(part.minY).toBe(full.minY);
      expect(part.maxY).toBe(full.maxY);
      expect(part.count).toBe(Math.ceil(full.total * band));
      expect(bits(part.offsets)).toEqual(bits(full.offsets, part.count * 3));
      expect(bits(part.instanceData)).toEqual(bits(full.instanceData, part.count * 3));
    }
    expect(full.count).toBe(full.total);
  }
});

test("blades arrive in descending shader fade key", () => {
  for (const [cx, cz] of chunks) {
    const { count, instanceData } = generateChunk(cx, cz, GRASS, 1);
    const key = new Float32Array(1);
    let prev = Infinity;
    let outOfOrder = 0;
    for (let i = 0; i < count; i++) {
      const v = instanceData[i * 3] * 1.618 + instanceData[i * 3 + 2] * 12.9898;
      key[0] = v - Math.floor(v);
      if (key[0] > prev) outOfOrder++;
      prev = key[0];
    }
    expect(outOfOrder).toBe(0);
  }
});

test("a grid-cache hit places exactly what the cold sample placed", () => {
  const [cx, cz] = chunks[0];
  const other = { ...GRASS, biomeIds: [GRASS_BIOME.id, 1] }; // a distinct cache key → a cold grid
  const cold = generateChunk(cx, cz, other, 1);
  const hit = generateChunk(cx, cz, other, 1);
  expect(hit.total).toBe(cold.total);
  expect(bits(hit.offsets)).toEqual(bits(cold.offsets));
  expect(bits(hit.instanceData)).toEqual(bits(cold.instanceData));
});
