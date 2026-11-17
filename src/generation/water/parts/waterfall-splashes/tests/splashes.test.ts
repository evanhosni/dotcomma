/** White water at the foot of every fall and on every fall boulder's face (generation/water/parts/waterfall-splashes/index.ts): the same
 *  emitters however the world is cut into chunks, on their own water, none without a fall, and no burst
 *  where no boulder is mounted. */
import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { runDressingEnumerator } from "../../../../../objects/dressing/registry";
import { computeVertexData, getRiverSplashEmitters, initCompute, type SplashEmitter } from "../../../..";
import { biomeById } from "../../../../registry";
import { isLakeBiome } from "../../../lakes/params";

const PARAMS = { spacing: 2.6, count: 24 };
const CONFIG = DOMAIN_CONFIGS.overworld;
/** The overworld with its <Water> base changed for one test. */
const withWater = (water: Partial<NonNullable<typeof CONFIG.water>>, run: () => void): void => {
  initCompute({ ...CONFIG, water: { ...CONFIG.water!, ...water } });
  try {
    run();
  } finally {
    initCompute(CONFIG);
  }
};
const key = (e: SplashEmitter) => `${e.x.toFixed(3)},${e.z.toFixed(3)},${e.burst}`;

/** The first 512u square around the origin holding any emitter. */
const findFalls = (): { x0: number; z0: number } => {
  for (let r = 0; r < 14; r++) {
    for (let x = -r * 512; x <= r * 512; x += 512) {
      for (let z = -r * 512; z <= r * 512; z += 512) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r * 512) continue;
        if (getRiverSplashEmitters(x, z, x + 512, z + 512, PARAMS).length > 0) return { x0: x, z0: z };
      }
    }
  }
  throw new Error("no fall within 7 km");
};

describe("getRiverSplashEmitters", () => {
  beforeAll(() => initCompute(CONFIG));

  it("gives the same emitters however the box is split into chunks", () => {
    const { x0, z0 } = findFalls();
    const whole = getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS).map(key).sort();
    const parts = [
      ...getRiverSplashEmitters(x0, z0, x0 + 256, z0 + 256, PARAMS),
      ...getRiverSplashEmitters(x0 + 256, z0, x0 + 512, z0 + 256, PARAMS),
      ...getRiverSplashEmitters(x0, z0 + 256, x0 + 256, z0 + 512, PARAMS),
      ...getRiverSplashEmitters(x0 + 256, z0 + 256, x0 + 512, z0 + 512, PARAMS),
    ].map(key);
    expect(parts.sort()).toEqual(whole);
    expect(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS).map(key).sort()).toEqual(whole);
  });

  it("stands every emitter on its own water, never in a lake biome, 0.1–1.3u over it", () => {
    const { x0, z0 } = findFalls();
    const emitters = getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS);
    for (const e of emitters) {
      expect(e.strength).toBeGreaterThan(0);
      expect(e.strength).toBeLessThanOrEqual(1);
      expect(e.count).toBeGreaterThanOrEqual(PARAMS.count * 0.5);
      expect(e.count).toBeLessThanOrEqual(PARAMS.count * 1.6);
    }
    // Each rolls its own strength: no two alike.
    expect(new Set(emitters.map((e) => e.strength.toFixed(6))).size).toBeGreaterThan(emitters.length / 2);
    for (const e of emitters.filter((q) => q.burst === 0)) {
      const v = computeVertexData(e.x, e.z);
      expect(e.y).toBeGreaterThanOrEqual(v.waterHeight + 0.1 - 1e-6);
      expect(e.y).toBeLessThanOrEqual(v.waterHeight + 1.3 + 1e-6);
      expect(isLakeBiome(biomeById(v.biomeId) ?? {})).toBeFalsy();
    }
  });

  it("places nothing where no piece falls steeper than the <Water> base's fall grade", () => {
    const { x0, z0 } = findFalls();
    withWater({ params: { ...CONFIG.water!.params, fallGrade: 10 } }, () => expect(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS)).toEqual([]));
  });

  it("bursts on boulders only where <WaterfallBoulders/> is mounted", () => {
    const { x0, z0 } = findFalls();
    const { waterfallBoulders: _boulders, ...parts } = CONFIG.water!.parts;
    withWater({ parts }, () => expect(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS).filter((e) => e.burst === 1)).toEqual([]));
  });

  it("is what the waterfallSplashes enumerator runs", () => {
    const { x0, z0 } = findFalls();
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    expect(runDressingEnumerator("waterfallSplashes", b, PARAMS)).toEqual(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS));
  });
});
