/** Standalone PONDS (index.ts): deterministic whatever the query order and window, only in the biomes
 *  that mount their kind, clear of lakes, rivers, roads, the city and each other, and the <Actor>s inside
 *  them stand in their shallows (the body's zone placement: generation/placement/registry.ts). */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { biomeIdOf } from "../../../../world/content/config";
import { roadBearingBiomeIds } from "../../../registry";
import { featurePlacesIn } from "../../../placement/registry";
import { riverKeepOff } from "../../rivers/constants";
import { RIVER_FIELD_READ } from "../../constants";
import { riverPiecesNear } from "../../rivers/network";
import { waterGroundAt } from "../../utils";
import { nearestFreewayRun, nearestRun, networkOf } from "../../../roads/freeways/network";
import { findNearestCityWall, nearestCityWall } from "../../../roads/freeways";
import { computeVertexData, initCompute, unwarp } from "../../..";
import { cityWallsOf, getBiomeContext } from "../../../zones";
import { shoreReach } from "../../lakes";
import { SHALLOWS_DEPTH } from "../../parts/params";
import { clearPonds, pondsIn } from "..";
import { type PondPlace } from "../types";
import { pondsOf } from "../params";
import { isLakeBiome } from "../../lakes/params";

const CONFIG = DOMAIN_CONFIGS.overworld;
const H = 10000;
const footprint = (s: PondPlace) => riverKeepOff() * s.disc.width * (1 + s.disc.amount);
const ids = (list: PondPlace[]) => list.map((s) => `${s.key}@${s.disc.x.toFixed(6)},${s.disc.z.toFixed(6)},${s.disc.level.toFixed(6)}`).sort();

describe("standalone ponds", () => {
  let all: PondPlace[] = [];
  beforeAll(() => {
    initCompute(CONFIG);
    all = pondsIn(-H, -H, H, H);
  });

  it("stand somewhere: the grass's ponds", () => {
    expect(all.length).toBeGreaterThan(5);
  });

  it("are the same whatever the query order and window", () => {
    clearPonds();
    const pieces: PondPlace[] = [];
    for (let x = H - 2500; x >= -H; x -= 2500) for (let z = -H; z < H; z += 3333) pieces.push(...pondsIn(x, z, x + 2500, Math.min(H, z + 3333)));
    expect(ids(pieces)).toEqual(ids(all));
  });

  it("stand only in biomes that mount their kind with a standalone chance", () => {
    for (const s of all) {
      expect(getBiomeContext(s.disc).zone.biome.id).toBe(s.biomeId);
      expect(pondsOf(s.biomeId).some((m) => m.kind.id === s.mount.kind.id && m.standalone > 0)).toBe(true);
    }
  });

  it("keep clear of lakes, rivers, roads, the city and each other", () => {
    const fw = CONFIG.cityConfig.freewayWidth;
    for (const s of all) {
      const { x, z } = s.disc;
      const fp = footprint(s);
      const ctx = getBiomeContext({ x, z });
      expect(isLakeBiome(ctx.zone.biome)).toBeFalsy();
      expect(roadBearingBiomeIds()).not.toContain(ctx.zone.biome.id);
      expect(waterGroundAt(x, z).shore).toBeGreaterThanOrEqual(shoreReach());
      for (const p of riverPiecesNear(x - 2000, z - 2000, x + 2000, z + 2000, 0)) {
        const dx = p.ex - p.sx;
        const dz = p.ez - p.sz;
        const t = Math.max(0, Math.min(1, ((x - p.sx) * dx + (z - p.sz) * dz) / (dx * dx + dz * dz)));
        expect(Math.hypot(x - p.sx - dx * t, z - p.sz - dz * t)).toBeGreaterThanOrEqual(fp + RIVER_FIELD_READ + riverKeepOff() * Math.max(p.w0, p.w1));
      }
      nearestFreewayRun(x, z, networkOf(ctx).freeways);
      expect(nearestRun.distance).toBeGreaterThanOrEqual(fp + fw);
      findNearestCityWall(x, z, cityWallsOf(ctx));
      expect(nearestCityWall.distance).toBeGreaterThanOrEqual(fp + fw);
      for (const o of all) if (o !== s) expect(Math.hypot(o.disc.x - x, o.disc.z - z)).toBeGreaterThanOrEqual(fp + footprint(o));
    }
  });

  it("hold water at their level as their own body, and stand an <Actor> inside them in their shallows", () => {
    const grass = biomeIdOf(CONFIG, "grass");
    let places = 0;
    for (const s of all.slice(0, 6)) {
      const c = unwarp(s.disc.x, s.disc.z);
      const v = computeVertexData(c.x, c.z);
      expect(v.waterHeight).toBeCloseTo(s.disc.level, 6);
      expect(v.waterHeight - v.height).toBeGreaterThan(3);
      expect(CONFIG.waterBodies[v.waterBody]).toMatchObject({ kind: "pond", id: `pond:${s.mount.kind.id}` });
      if (s.biomeId !== grass) continue;
      const area = { minX: c.x - 400, minZ: c.z - 400, maxX: c.x + 400, maxZ: c.z + 400 };
      const beebles = { id: "beeble@pond:pond", feature: `pond:${s.mount.kind.id}`, density: 3000, biomeIds: [grass] };
      for (const p of featurePlacesIn(beebles, area)) {
        const at = computeVertexData(p.x, p.z);
        places++;
        expect(at.height).toBeCloseTo(p.floor, 6);
        expect(at.waterHeight - at.height).toBeGreaterThan(0);
        expect(at.waterHeight - at.height).toBeLessThan(SHALLOWS_DEPTH);
        expect(CONFIG.waterBodies[at.waterBody].id).toBe(`pond:${s.mount.kind.id}`);
      }
    }
    expect(places).toBeGreaterThan(6);
  });
});
