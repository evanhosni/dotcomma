/** Bubble emitters lie on a lake's bed under enough water, chunk-owned and deterministic. */
import { OVERWORLD_CONFIG } from "../../world/domains/overworld/config";
import { LAKE_BIOME } from "../../world/domains/overworld/regions/ocean/biomes/lake/spec";
import { runDressingEnumerator } from "../../objects/dressing/enumerators";
import { computeVertexData, computeVertexDataRaw, getLakeBubbleEmitters, initCompute, waterBiomeIds } from "./vertexCompute";

const config = OVERWORLD_CONFIG;
beforeAll(() => initCompute(config));

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;
const PARAMS = { density: 120, seedTag: "bubbles", minDepth: 3, count: 6 };

/** The deepest lake interior within a coarse scan. */
const findLake = (): { x: number; z: number } => {
  let best = -Infinity;
  let at = { x: 0, z: 0 };
  for (let x = -8000; x <= 8000; x += 250) {
    for (let z = -8000; z <= 8000; z += 250) {
      const vd = computeVertexDataRaw(x, z);
      if (vd.biomeId === LAKE_BIOME.id && vd.distanceToBiomeBoundaryCenter > best) {
        best = vd.distanceToBiomeBoundaryCenter;
        at = { x, z };
      }
    }
  }
  expect(best).toBeGreaterThan(100);
  return at;
};

describe("getLakeBubbleEmitters", () => {
  it("names the water biomes", () => {
    expect(waterBiomeIds()).toEqual([LAKE_BIOME.id]);
  });

  it("is deterministic, duplicate-free across chunk splits, and lies on the bed under deep water", () => {
    const { x, z } = findLake();
    const x0 = Math.floor(x / 256) * 256 - 256;
    const z0 = Math.floor(z / 256) * 256 - 256;
    const whole = getLakeBubbleEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS);
    expect(whole.length).toBeGreaterThan(0);
    const parts = [
      ...getLakeBubbleEmitters(x0, z0, x0 + 256, z0 + 256, PARAMS),
      ...getLakeBubbleEmitters(x0 + 256, z0, x0 + 512, z0 + 256, PARAMS),
      ...getLakeBubbleEmitters(x0, z0 + 256, x0 + 256, z0 + 512, PARAMS),
      ...getLakeBubbleEmitters(x0 + 256, z0 + 256, x0 + 512, z0 + 512, PARAMS),
    ];
    expect(new Set(parts.map(key)).size).toBe(parts.length);
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
    for (const e of whole) {
      const vd = computeVertexData(e.x, e.z);
      expect(vd.biomeId).toBe(LAKE_BIOME.id);
      expect(e.y).toBeCloseTo(vd.height + 0.2, 5);
      expect(e.depth).toBeGreaterThanOrEqual(PARAMS.minDepth);
      expect(e.depth).toBeCloseTo(vd.waterHeight - vd.height, 5);
      expect(e.count).toBe(PARAMS.count);
    }
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    expect(runDressingEnumerator("lakeBubbles", b, PARAMS)).toEqual(whole);
  });

  it("places nothing on dry land", () => {
    // The city/grass interior cityFeatures.test.ts scans is land; here any chunk far from the lake found.
    const { x, z } = findLake();
    expect(getLakeBubbleEmitters(x + 6000, z + 6000, x + 6256, z + 6256, PARAMS).every((e) => e.depth >= PARAMS.minDepth)).toBe(true);
  });
});
