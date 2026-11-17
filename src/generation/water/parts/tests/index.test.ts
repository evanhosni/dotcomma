/** A body of water's parts stand where the body owns the vertex, in their zone (params.ts waterZoneOf):
 *  chunk-owned and deterministic; and the bodies are the mounts (presence by mounting). */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { runDressingEnumerator } from "../../../../objects/dressing/registry";
import { biomeIdOf } from "../../../../world/content/config";
import { riverPiecesNear } from "../../rivers/network";
import { computeVertexData, computeVertexDataRaw, getWaterEmitters, initCompute, unwarp } from "../../..";
import { lakeBiomeIds, lakeBodyOf } from "../../lakes/params";
import { bodyOf } from "../../params";
import { waterBodiesWith, waterOwnedBy, waterZoneOf } from "../params";
import type { ZonedBody } from "../../types";
import { getPondSurfaceEmitters, waterPartPointsIn } from "..";

const CONFIG = DOMAIN_CONFIGS.overworld;
const LAKE_BIOME = biomeIdOf(CONFIG, "lake");

beforeAll(() => initCompute(CONFIG));

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;

/** The bubbles' own emitter args, with the bodies (and zones) their driver hands them. */
const params = () => ({
  density: 120,
  seedTag: "bubbles",
  minDepth: 3,
  count: 6,
  bodies: waterBodiesWith("waterBubbles").map((m): ZonedBody => ({ slot: m.slot, zone: "submerged" })),
});

/** The deepest lake interior within a coarse scan. */
const findLake = (): { x: number; z: number } => {
  let best = -Infinity;
  let at = { x: 0, z: 0 };
  for (let x = -8000; x <= 8000; x += 250) {
    for (let z = -8000; z <= 8000; z += 250) {
      const vd = computeVertexDataRaw(x, z);
      if (vd.biomeId === LAKE_BIOME && vd.distanceToBiomeBoundaryCenter > best) {
        best = vd.distanceToBiomeBoundaryCenter;
        at = { x, z };
      }
    }
  }
  expect(best).toBeGreaterThan(100);
  return at;
};

describe("water bodies", () => {
  it("are the mounts, each the same shape: the lake biome's <Lake> holds the bubbles", () => {
    expect(lakeBiomeIds()).toEqual([LAKE_BIOME]);
    expect(waterBodiesWith("waterBubbles").map((m) => m.slot)).toEqual([lakeBodyOf(LAKE_BIOME)]);
    expect(CONFIG.waterBodies.filter((b) => b.id === "rivers" && b.regionId !== undefined).map((b) => b.regionId)).toEqual(CONFIG.regions.map((r) => r.id));
    // A dry biome's own <Rivers chance={0}/> is a body too (its water never exists), and so is the
    // mountain's, mounted for its banks alone.
    expect(CONFIG.waterBodies.filter((b) => b.id === "rivers" && b.biomeId !== undefined).map((b) => b.biomeId).sort()).toEqual(
      [biomeIdOf(CONFIG, "mountain"), biomeIdOf(CONFIG, "oasis")].sort(),
    );
    for (const body of CONFIG.waterBodies) expect(Object.keys(body).sort()).toEqual(["id", "kind", "params", "parts", ...(body.biomeId !== undefined ? ["biomeId"] : ["regionId"])].sort());
  });

  it("a biome carries its region's bodies it does not override", () => {
    const grass = biomeIdOf(CONFIG, "grass");
    const city = CONFIG.waterBodies.findIndex((b) => b.id === "rivers" && b.regionId === CONFIG.regions[0].id);
    expect(bodyOf(grass, "rivers")).toBe(city);
    expect(bodyOf(biomeIdOf(CONFIG, "mountain"), "rivers")).toBe(CONFIG.waterBodies.findIndex((b) => b.id === "rivers" && b.biomeId === biomeIdOf(CONFIG, "mountain")));
  });

  it("name the lake's own water at its centre", () => {
    const { x, z } = findLake();
    const vd = computeVertexData(x, z);
    expect(vd.waterBody).toBe(lakeBodyOf(LAKE_BIOME));
    expect(vd.waterBodyShare).toBe(1);
  });

  it("own a river's dry bank: its BANK zone", () => {
    const grass = biomeIdOf(CONFIG, "grass");
    let banks = 0;
    for (const p of riverPiecesNear(-6000, -6000, 6000, 6000, 0).slice(0, 40)) {
      const e = p.edge;
      for (const across of [44, 50]) {
        const w = unwarp((p.sx + p.ex) / 2 - e.uz * across * p.w0, (p.sz + p.ez) / 2 + e.ux * across * p.w0);
        const vd = computeVertexData(w.x, w.z);
        if (vd.waterHeight > vd.height || vd.biomeId !== grass || vd.distanceToRiverCenter >= CONFIG.river.halfWidth + CONFIG.river.bank) continue;
        expect(vd.waterBody).toBe(bodyOf(grass, "rivers"));
        expect(waterZoneOf(0)).toBe("bank");
        banks++;
      }
    }
    expect(banks).toBeGreaterThan(3);
  });
});

describe("the parts' scatter", () => {
  it("emitters are deterministic, duplicate-free across chunk splits, and lie on the bed under deep water the body owns", () => {
    const { x, z } = findLake();
    const p = params();
    const x0 = Math.floor(x / 256) * 256 - 256;
    const z0 = Math.floor(z / 256) * 256 - 256;
    const whole = getWaterEmitters(x0, z0, x0 + 512, z0 + 512, p);
    expect(whole.length).toBeGreaterThan(0);
    const parts = [
      ...getWaterEmitters(x0, z0, x0 + 256, z0 + 256, p),
      ...getWaterEmitters(x0 + 256, z0, x0 + 512, z0 + 256, p),
      ...getWaterEmitters(x0, z0 + 256, x0 + 256, z0 + 512, p),
      ...getWaterEmitters(x0 + 256, z0 + 256, x0 + 512, z0 + 512, p),
    ];
    expect(new Set(parts.map(key)).size).toBe(parts.length);
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
    for (const e of whole) {
      const vd = computeVertexData(e.x, e.z);
      expect(waterOwnedBy(p.bodies.map((b) => b.slot), vd.waterBody, vd.waterBodyShare, vd.waterBody2)).toBeGreaterThan(0);
      expect(e.y).toBeCloseTo(vd.height + 0.2, 5);
      expect(e.depth).toBeGreaterThanOrEqual(p.minDepth);
      expect(e.depth).toBeCloseTo(vd.waterHeight - vd.height, 5);
      expect(e.count).toBe(p.count);
    }
    const b = { minX: x0, minZ: z0, maxX: x0 + 512, maxZ: z0 + 512 };
    expect(runDressingEnumerator("waterEmitters", b, p)).toEqual(whole);
  });

  it("places nothing for a body that mounted no part, and only in the part's zone", () => {
    const { x, z } = findLake();
    const p = params();
    expect(getWaterEmitters(x - 256, z - 256, x + 256, z + 256, { ...p, bodies: [] })).toEqual([]);
    const slot = lakeBodyOf(LAKE_BIOME);
    for (const zone of ["submerged", "shallows", "bank"] as const) {
      for (const q of waterPartPointsIn(x - 2000, z - 2000, x + 2000, z + 2000, { density: 400, seedTag: "zone", bodies: [{ slot, zone }] })) {
        expect(waterZoneOf(q.depth)).toBe(zone);
      }
    }
  });
});

describe("a pond part's surface emitters", () => {
  const steam = () => ({
    density: 1500,
    minDepth: 0.5,
    count: 3,
    seedTag: "steam",
    // Every pond and rivers body, whether or not it mounts steam: the emitters are what is pinned here.
    bodies: CONFIG.waterBodies.flatMap((b, slot): ZonedBody[] => (b.kind === "lake" ? [] : [{ slot, zone: "submerged" }])),
  });
  it("rise only off the hot springs", () => {
    expect(waterBodiesWith("pondSteam").map((m) => m.body.id)).toEqual(["pond:hotSpring"]);
  });
  const inChunks = (x0: number, z0: number, size: number, n: number) => {
    const out = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(...getPondSurfaceEmitters(x0 + i * size, z0 + j * size, x0 + (i + 1) * size, z0 + (j + 1) * size, steam()));
    return out;
  };

  // A grass <Pond> at a river's end (-3359, 209) and the desert's at a salt river's end (-4172, -3390).
  it.each([
    [-3359, 209],
    [-4172, -3390],
  ])("stand on the still water of the pond at (%d, %d), the same however the chunks cut it", (cx, cz) => {
    const x0 = Math.floor(cx / 512) * 512 - 512;
    const z0 = Math.floor(cz / 512) * 512 - 512;
    const fine = inChunks(x0, z0, 256, 6);
    const coarse = inChunks(x0, z0, 512, 3);
    expect(fine.length).toBeGreaterThan(10);
    expect(fine.map(key).sort()).toEqual(coarse.map(key).sort());
    for (const e of fine) {
      const vd = computeVertexData(e.x, e.z);
      expect(e.y).toBe(vd.waterHeight);
      expect(vd.waterHeight - vd.height).toBeGreaterThanOrEqual(0.5);
      expect(Math.hypot(e.x - cx, e.z - cz)).toBeLessThan(250);
    }
  });
});
