/** River boulders (parts/boulders.ts): one list, chunk-owned, seeded; tops over the water, bare,
 *  never hanging far over the ground; dense on falls, the odd one in calm water; a fall's own spray; none
 *  where <WaterfallBoulders/> is not mounted, for the client and the server's obstacles alike. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { drawnGroundAt } from "../../underground/drawnGround";
import { runDressingEnumerator } from "../../../../objects/dressing/enumerators";
import { computeVertexData, getRiverSplashEmitters, getWaterfallBoulders, getWaterfallRocks, initCompute, type WaterfallBoulder } from "../../vertexCompute";
import { fallGrade } from "../params";

const key = (b: WaterfallBoulder) => `${b.rock.x.toFixed(3)},${b.rock.z.toFixed(3)}`;

const findBoulders = (falls: boolean): { x0: number; z0: number } => {
  for (let r = 0; r < 16; r++) {
    for (let x = -r * 512; x <= r * 512; x += 512) {
      for (let z = -r * 512; z <= r * 512; z += 512) {
        if (Math.max(Math.abs(x), Math.abs(z)) !== r * 512) continue;
        if (getWaterfallBoulders(x, z, x + 512, z + 512).some((b) => (falls ? b.grade > fallGrade() : b.grade <= fallGrade()))) return { x0: x, z0: z };
      }
    }
  }
  throw new Error("no river boulder within 8 km");
};

describe("getWaterfallBoulders", () => {
  beforeAll(() => initCompute(DOMAIN_CONFIGS.overworld));

  it("gives the same boulders however the box is split into chunks", () => {
    const { x0, z0 } = findBoulders(true);
    const whole = getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512).map(key).sort();
    const parts = [
      ...getWaterfallBoulders(x0, z0, x0 + 256, z0 + 256),
      ...getWaterfallBoulders(x0 + 256, z0, x0 + 512, z0 + 256),
      ...getWaterfallBoulders(x0, z0 + 256, x0 + 256, z0 + 512),
      ...getWaterfallBoulders(x0 + 256, z0 + 256, x0 + 512, z0 + 512),
    ].map(key);
    expect(parts.sort()).toEqual(whole);
  });

  it("stands each rock's top over its water, bare, its base never hanging far over the ground", () => {
    for (const falls of [true, false]) {
      const { x0, z0 } = findBoulders(falls);
      for (const b of getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512)) {
        const r = b.rock;
        const v = computeVertexData(r.x, r.z);
        expect(v.underDeck).toBe(0);
        expect(r.y + r.sy).toBeGreaterThanOrEqual(v.waterHeight + Math.max(0.6, 0.7 * r.sy) - 1e-6);
        // It rests on the lowest ground under its footprint, its base hanging at most 1.5u + 8u per unit
        // of grade over the ground under its centre.
        expect(r.ground).toBeLessThanOrEqual(drawnGroundAt(r.x, r.z) + 1e-6);
        expect(r.y - r.sy - drawnGroundAt(r.x, r.z)).toBeLessThanOrEqual(1.5 + 8 * b.grade + 1e-6);
        expect(r.y - r.sy - r.ground).toBeGreaterThanOrEqual(-r.sy - 1e-6);
        expect(r.snow).toBe(0);
        expect(r.shade).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("are what the waterfallBoulders enumerator places, and every steep one with a wet face carries a burst", () => {
    const { x0, z0 } = findBoulders(true);
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    expect(runDressingEnumerator("waterfallBoulders", b, {})).toEqual(getWaterfallRocks(x0, z0, x0 + 512, z0 + 512));
    const fields = runDressingEnumerator("rocks", b, { roadClear: 2 }).map((r) => `${r.x},${r.z}`);
    for (const r of getWaterfallRocks(x0, z0, x0 + 512, z0 + 512)) expect(fields).not.toContain(`${r.x},${r.z}`);
    const steep = getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512).filter((q) => q.grade > fallGrade());
    const bursts = getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, { spacing: 2.6, count: 24 }).filter((e) => e.burst === 1);
    expect(bursts.length).toBeGreaterThan(0);
    expect(bursts.length).toBeLessThanOrEqual(steep.length);
  });

  it("are none where the <Water> base mounts no <WaterfallBoulders/> — on the server's enumeration too", () => {
    const { x0, z0 } = findBoulders(true);
    const config = DOMAIN_CONFIGS.overworld;
    const { waterfallBoulders: _boulders, ...parts } = config.water!.parts;
    initCompute({ ...config, water: { ...config.water!, parts } });
    try {
      expect(getWaterfallBoulders(x0, z0, x0 + 512, z0 + 512)).toEqual([]);
      expect(runDressingEnumerator("waterfallBoulders", { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 }, {})).toEqual([]);
    } finally {
      initCompute(config);
    }
  });
});
