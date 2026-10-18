/** Splash emitters stand at the foot of steep river drops, over the water, chunk-owned and deterministic. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { runDressingEnumerator } from "../../../objects/dressing/enumerators";
import { computeVertexData, getRiverSplashEmitters, initCompute } from "../vertexCompute";

const config = OVERWORLD_CONFIG;
beforeAll(() => initCompute(config));

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;
/** Low enough to find drops in a scan of a few chunks whatever the terrain (the mount's own is 0.25). */
const PARAMS = { minGrade: 0.03, spacing: 4, count: 24 };

/** A 512u square holding emitters, found by a coarse scan of 256u chunks. */
const findSquare = (): { x0: number; z0: number } => {
  for (let x = -4096; x < 4096; x += 512) {
    for (let z = -4096; z < 4096; z += 512) {
      if (getRiverSplashEmitters(x, z, x + 512, z + 512, PARAMS).length > 0) return { x0: x, z0: z };
    }
  }
  throw new Error("no steep river stretch within ±4km");
};

describe("getRiverSplashEmitters", () => {
  it("is deterministic, duplicate-free across chunk splits, and stands just over the river's water", () => {
    const { x0, z0 } = findSquare();
    const whole = getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS);
    expect(whole.length).toBeGreaterThan(0);
    const parts = [
      ...getRiverSplashEmitters(x0, z0, x0 + 256, z0 + 256, PARAMS),
      ...getRiverSplashEmitters(x0 + 256, z0, x0 + 512, z0 + 256, PARAMS),
      ...getRiverSplashEmitters(x0, z0 + 256, x0 + 256, z0 + 512, PARAMS),
      ...getRiverSplashEmitters(x0 + 256, z0 + 256, x0 + 512, z0 + 512, PARAMS),
    ];
    expect(new Set(parts.map(key)).size).toBe(parts.length);
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
    expect(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS).map(key)).toEqual(whole.map(key));
    for (const e of whole) {
      expect(e.count).toBeGreaterThanOrEqual(PARAMS.count * 0.5);
      expect(e.count).toBeLessThanOrEqual(PARAMS.count * 1.6);
      expect(e.strength).toBeGreaterThanOrEqual(0);
      expect(e.strength).toBeLessThanOrEqual(1);
      const vd = computeVertexData(e.x, e.z);
      // Over water (the lower surface), within the channel's reach.
      expect(vd.distanceToRiverCenter).toBeLessThan(config.river.halfWidth + config.river.bank);
      expect(e.y).toBeGreaterThan(vd.height - config.river.depth * 2);
    }
  });

  it("an impossible threshold yields none", () => {
    const { x0, z0 } = findSquare();
    expect(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, { ...PARAMS, minGrade: 10 })).toEqual([]);
  });

  it("runs through the dressing enumerator table", () => {
    const { x0, z0 } = findSquare();
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    expect(runDressingEnumerator("riverSplashes", b, PARAMS)).toEqual(getRiverSplashEmitters(x0, z0, x0 + 512, z0 + 512, PARAMS));
  });
});
