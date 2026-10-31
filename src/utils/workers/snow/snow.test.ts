/** The movement modifiers (physics/movementModifiers.ts) as the snow fills them: depth → speed factor
 *  and slope bonus, no snow for a capsule off the drawn ground, and the sheet's own rule. */
import { DOMAIN_CONFIGS } from "../../../world/domains";
import { combineMovementModifiers, createMovementModifiers, SLOPE_BONUS_LIMIT } from "../../../physics/movementModifiers";
import { findBiomeCell, getBiomeCellSite, getSnowDrift, initCompute, surfaceModifiersAt } from "../vertexCompute";
import { drawnGroundAt } from "../underground/drawnGround";
import { DRESSING_ENUMERATORS } from "../../../objects/dressing/enumerators";
import { biomeIdOf } from "../../../world/content/config";

const MOUNTAIN_BIOME = { id: biomeIdOf(DOMAIN_CONFIGS.overworld, "mountain") };

const OVERWORLD_CONFIG = DOMAIN_CONFIGS.overworld;

jest.setTimeout(300_000);
beforeAll(() => initCompute(OVERWORLD_CONFIG));

/** A point in a snow pile near the mountain's cell site. */
const snowyPoint = (): { x: number; z: number; depth: number } | null => {
  const cell = findBiomeCell(MOUNTAIN_BIOME.id, { ix: 0, iz: 0 })!;
  const site = getBiomeCellSite(cell.ix, cell.iz);
  for (let r = 0; r <= 400; r += 20) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const x = site.x + Math.cos(a) * r;
      const z = site.z + Math.sin(a) * r;
      const m = surfaceModifiersAt(x, z);
      if (m.snowDepth > 0.05) return { x, z, depth: m.snowDepth };
    }
  }
  return null;
};

describe("snow", () => {
  it("slows and shoulders a capsule by its depth, and not one off the drawn ground", () => {
    const p = snowyPoint();
    expect(p).not.toBeNull();
    const { x, z, depth } = p!;
    expect(depth).toBeLessThanOrEqual(1.85);
    const m = surfaceModifiersAt(x, z, drawnGroundAt(x, z));
    expect(m.snowDepth).toBeCloseTo(depth, 9);
    expect(m.speedFactor).toBeCloseTo(Math.max(0.25, 1 - 0.42 * depth), 9);
    expect(m.slopeBonus).toBeCloseTo(Math.min((12 * Math.PI) / 180, (8 * Math.PI) / 180 * depth), 9);
    const off = surfaceModifiersAt(x, z, drawnGroundAt(x, z) + 5);
    expect(off.speedFactor).toBe(1);
    expect(off.slopeBonus).toBe(0);
    expect(off.snowDepth).toBe(0);
  });

  it("clamps the slope bonus to the limit and multiplies speed factors", () => {
    const m = createMovementModifiers();
    combineMovementModifiers(m, 0.5, 0.2);
    combineMovementModifiers(m, 0.5, 0.2);
    expect(m.speedFactor).toBe(0.25);
    expect(m.slopeBonus).toBe(SLOPE_BONUS_LIMIT);
  });

  it("lays a sheet the snow's depth over the drawn ground, its cut vertices just under it", () => {
    const p = snowyPoint()!;
    const x0 = Math.floor(p.x / 256) * 256;
    const z0 = Math.floor(p.z / 256) * 256;
    const [sheet] = getSnowDrift({ minX: x0, minZ: z0, maxX: x0 + 256, maxZ: z0 + 256 });
    expect(sheet).toBeDefined();
    expect(sheet.indices.length).toBeGreaterThan(0);
    let nodes = 0;
    for (let i = 0; i < sheet.positions.length; i += 3) {
      const x = sheet.positions[i] + sheet.x;
      const z = sheet.positions[i + 2] + sheet.z;
      const gap = sheet.positions[i + 1] - drawnGroundAt(x, z);
      const depth = sheet.depths[i / 3];
      // Grid nodes stand the snow's DEPTH over the drawn ground (the sheet is the snow's surface); the
      // cut's vertices lie just under the ground.
      if (depth > 0) {
        nodes++;
        expect(Math.abs(gap - depth)).toBeLessThan(1e-3); // float32 positions
      } else expect(gap).toBeLessThan(0);
      expect(gap).toBeGreaterThan(-0.4);
      expect(depth).toBeLessThanOrEqual(1.85 + 1e-6); // float32 depths
    }
    expect(nodes).toBeGreaterThan(0);
  });

  it("the dressing enumerator skips a chunk only where the sheet is empty (the probe's reach is sound)", () => {
    // Every chunk of a 7×7 ring around the mountain cell's site: the walls, the blend bands past them
    // and the plain neighbours. Wherever the sheet exists, the enumerator must hand it over.
    const cell = findBiomeCell(MOUNTAIN_BIOME.id, { ix: 0, iz: 0 })!;
    const site = getBiomeCellSite(cell.ix, cell.iz);
    let sheets = 0;
    let skipped = 0;
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        const x0 = Math.floor(site.x / 256 + i) * 256;
        const z0 = Math.floor(site.z / 256 + j) * 256;
        const b = { minX: x0, minZ: z0, maxX: x0 + 256, maxZ: z0 + 256 };
        const direct = getSnowDrift(b);
        const viaEnumerator = DRESSING_ENUMERATORS.snowDrift(b, {});
        expect(viaEnumerator.length).toBe(direct.length);
        if (direct.length > 0) sheets++;
        else skipped++;
      }
    }
    expect(sheets).toBeGreaterThan(0);
    expect(skipped).toBeGreaterThan(0);
  });
});
