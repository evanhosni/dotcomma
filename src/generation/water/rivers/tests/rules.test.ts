/** The <Rivers> GAP RULES (params.ts GapRules) and every river prop resolve biome → region → <Water
 *  defaults={{ rivers }}> → RIVERS_DEFAULTS, and an edge is judged by the rules of the biome under its
 *  midpoint — the biome its chance is rolled in. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { biomeIdOf } from "../../../../world/content/config";
import type { DomainConfig } from "../../../types";
import { initCompute } from "../../..";
import { zoneAtWarped } from "../../../zones";
import { riverPiecesNear } from "../network";
import { RIVERS_DEFAULTS, riversIn } from "../params";

const OVERWORLD = DOMAIN_CONFIGS.overworld;
const GRASS = biomeIdOf(OVERWORLD, "grass");

/** The overworld with a domain-wide <Rivers> default and grass's own override. */
const withRules: DomainConfig = {
  ...OVERWORLD,
  water: { ...OVERWORLD.water!, params: { ...OVERWORLD.water!.params, defaults: { rivers: { maxCarve: 60, gapFill: 700 } } } },
  regions: OVERWORLD.regions.map((r) => ({
    ...r,
    biomes: r.biomes.map((b) => (b.id === GRASS ? { ...b, features: { ...b.features, rivers: { maxCarve: 40 } } } : b)),
  })),
};

describe("<Rivers> props", () => {
  afterAll(() => initCompute(OVERWORLD));

  it("are the defaults in the overworld", () => {
    initCompute(OVERWORLD);
    for (const e of riverPiecesNear(-6000, -6000, 6000, 6000, 0).map((p) => p.edge)) {
      expect({ ...e.rules }).toEqual(expect.objectContaining({ maxGrade: 0.2, maxRidge: 6, maxCrossGrade: 0.15, minStretch: 300, gapFill: 800, maxCarve: 80, shortGap: 500, summitMaxGap: 3000 }));
    }
    expect(RIVERS_DEFAULTS.wallReach).toBe(1000);
  });

  it("resolve the biome's own over the <Water> base's over the defaults, and judge an edge by its midpoint's", () => {
    initCompute(withRules);
    let grass = 0;
    let other = 0;
    for (const e of new Set(riverPiecesNear(-8000, -8000, 8000, 8000, 0).map((p) => p.edge))) {
      const zone = zoneAtWarped((e.a.x + e.b.x) / 2, (e.a.z + e.b.z) / 2);
      expect(e.rules).toBe(riversIn(zone));
      expect(e.rules.gapFill).toBe(700);
      expect(e.rules.shortGap).toBe(500);
      if (zone.biome.id === GRASS) {
        expect(e.rules.maxCarve).toBe(40);
        grass++;
      } else {
        expect(e.rules.maxCarve).toBe(60);
        other++;
      }
    }
    expect(grass).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
  });
});
