/** Waterfall boulders stand out of the sheet of every steep river piece, bare, chunk-owned and deterministic;
 *  the rocks enumerator draws them and the splash enumerator stands a burst on each wet face. */
import { ROCK_PLACEMENT } from "../../../objects/dressing/rocks/spec";
import { runDressingEnumerator } from "../../../objects/dressing/enumerators";
import { DOMAIN_CONFIGS } from "../../../world/domains";
import { drawnGroundAt } from "../underground/drawnGround";
import { computeVertexData, getRiverSplashEmitters, getWaterfallBoulders, getWaterfallRocks, initCompute, WATERFALL_GRADE } from "../vertexCompute";

const OVERWORLD_CONFIG = DOMAIN_CONFIGS.overworld;

jest.setTimeout(300000);

const config = OVERWORLD_CONFIG;
beforeAll(() => initCompute(config));

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;

/** A 512u square holding a fall's boulders, found by a coarse scan. */
const findSquare = (): { x0: number; z0: number } => {
  for (let x = -4096; x < 4096; x += 512) {
    for (let z = -4096; z < 4096; z += 512) {
      if (getWaterfallBoulders(x, z, x + 512, z + 512).some((b) => b.grade > WATERFALL_GRADE)) return { x0: x, z0: z };
    }
  }
  throw new Error("no waterfall within ±4km");
};

describe("getWaterfallBoulders", () => {
  it("is deterministic, duplicate-free across chunk splits, and stands out of the water, bare", () => {
    const { x0, z0 } = findSquare();
    const whole = getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512);
    expect(whole.length).toBeGreaterThan(0);
    const parts = [
      ...getWaterfallBoulders(x0, z0, x0 + 256, z0 + 256),
      ...getWaterfallBoulders(x0 + 256, z0, x0 + 512, z0 + 256),
      ...getWaterfallBoulders(x0, z0 + 256, x0 + 256, z0 + 512),
      ...getWaterfallBoulders(x0 + 256, z0 + 256, x0 + 512, z0 + 512),
    ];
    expect(new Set(parts.map((b) => key(b.rock))).size).toBe(parts.length);
    expect(parts.map((b) => key(b.rock)).sort()).toEqual(whole.map((b) => key(b.rock)).sort());
    expect(getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512)).toEqual(whole);
    for (const b of whole) {
      const r = b.rock;
      expect(r.x).toBeGreaterThanOrEqual(x0);
      expect(r.x).toBeLessThan(x0 + 512);
      expect(r.snow).toBe(0);
      expect(b.grade).toBeGreaterThanOrEqual(0);
      expect(Math.hypot(b.dirX, b.dirZ)).toBeCloseTo(1, 6);
      const vd = computeVertexData(r.x, r.z);
      expect(vd.waterDepth).toBeGreaterThan(0);
      // Its top breaks the surface; its base rests on, or hangs at most 1.5u + 8u per unit of grade over,
      // the ground under its centre.
      expect(r.y + r.sy).toBeGreaterThanOrEqual(vd.waterHeight + Math.max(0.6, 0.7 * r.sy) - 1e-9);
      expect(r.y - r.sy - drawnGroundAt(r.x, r.z)).toBeLessThanOrEqual(1.5 + 8 * b.grade + 1e-9);
      expect(r.y - r.sy - r.ground).toBeGreaterThanOrEqual(-r.sy - 1e-9);
    }
  });

  it("the rocks enumerator draws them with the field rocks", () => {
    const { x0, z0 } = findSquare();
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    const all = runDressingEnumerator("rocks", b, ROCK_PLACEMENT).map(key);
    for (const r of getWaterfallRocks(x0, z0, x0 + 512, z0 + 512)) expect(all).toContain(key(r));
  });

  it("the splash enumerator stands one burst on each FALL boulder with a wet upstream face, none in calm water", () => {
    const { x0, z0 } = findSquare();
    const boulders = getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512);
    const steep = boulders.filter((b) => b.grade > WATERFALL_GRADE);
    expect(steep.length).toBeGreaterThan(0);
    const bursts = getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, { minGrade: 0.25, spacing: 2.6, count: 24 }).filter((e) => e.burst === 1);
    expect(bursts.length).toBeGreaterThan(0);
    expect(bursts.length).toBeLessThanOrEqual(steep.length);
    for (const e of bursts) {
      const vd = computeVertexData(e.x, e.z);
      expect(vd.waterDepth).toBeGreaterThan(0);
      expect(e.y).toBeGreaterThan(vd.height);
      expect(e.count).toBeGreaterThanOrEqual(24 * 0.5);
      expect(e.count).toBeLessThanOrEqual(24 * 1.6);
    }
  });
});
