/** Terrain seams outside the zone weights (CLAUDE.md "Blending", "Rivers", "Lakes"): places where a
 *  layer above the wall pass switched between two inputs — a river's nearest piece, a freeway's leg at
 *  a bend, the city's curb under a shore lift, a drowned belt, a lake level's support — and the height
 *  stepped. Each measured place is pinned, and every biome wall of a square is crossed. */
import { OVERWORLD_CONFIG } from "../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../world/constants";
import { combineSlotWeights, computeVertexDataRaw, getBiomeSlots, initCompute, riverbedSlotHalvesOf, unwarp, warp } from "./vertexCompute";
import { biomeSiteAt, getBiomeContext, getBiomeGrid, getZoneWalls } from "./voronoi";
import { riverbedSdfAt } from "./zoneBlend";

beforeAll(() => initCompute(OVERWORLD_CONFIG));

const height = (x: number, z: number) => computeVertexDataRaw(x, z).height;

/** The largest step of the full (raw) height in a box around (x0, z0): the biggest neighbor difference
 *  on a `st` lattice, bisected down to ~1e-9u. A continuous surface leaves ~0 there. */
const largestStepNear = (x0: number, z0: number, r = 1.5, st = 0.1): number => {
  let best = { j: 0, x: 0, z: 0, dx: 0, dz: 0 };
  for (let x = x0 - r; x <= x0 + r; x += st) {
    for (let z = z0 - r; z <= z0 + r; z += st) {
      const h = height(x, z);
      for (const [dx, dz] of [
        [st, 0],
        [0, st],
      ]) {
        const j = height(x + dx, z + dz) - h;
        if (Math.abs(j) > Math.abs(best.j)) best = { j, x, z, dx, dz };
      }
    }
  }
  let ax = best.x;
  let az = best.z;
  let bx = best.x + best.dx;
  let bz = best.z + best.dz;
  for (let it = 0; it < 30; it++) {
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    if (Math.abs(height(mx, mz) - height(ax, az)) > Math.abs(height(bx, bz) - height(mx, mz))) {
      bx = mx;
      bz = mz;
    } else {
      ax = mx;
      az = mz;
    }
  }
  return Math.abs(height(bx, bz) - height(ax, az));
};

describe("terrain seams", () => {
  // Each place stepped by the amount in its name before.
  it.each([
    ["a river's surface where its nearest piece jumped to a pond (10.9u)", -6301.4, 3511.49],
    ["a river's bank beside a mountain junction (0.14u)", -11985.3, 1881.8],
    ["a freeway on the outer side of a bend (1.14u)", -11039.4, 9513.7],
    ["a freeway leaving a belt corner (0.27u)", -11123.3, 9733.6],
    ["the city's curb under a lake's shore lift (0.3u)", -9954.15, 5612.09],
    ["a city wall the river drowns (1.21u)", -7155.73, 7011.25],
    ["the waterfront switching on far from its wall (1.9u)", -954.44, 1034.01],
    ["the waterfront taking the belt over at a trace of drowning (0.3u)", 2132.74, -7627.94],
    ["a shore lift past the lake level's support (33u)", -523.24, 276.59],
  ])("%s", (_name, x, z) => {
    expect(largestStepNear(x, z)).toBeLessThan(0.01);
  });

  it("are gone from every biome wall of a square: no crossing steps more than 0.1u, city walls and rivers included", () => {
    const gs = OVERWORLD_CONFIG.gridSize;
    const area = 3500;
    const seen = new Set<string>();
    let crossings = 0;
    let cityRiver = 0;
    let worst = 0;
    const reach = OVERWORLD_CONFIG.river.halfWidth + OVERWORLD_CONFIG.river.bank;
    for (let ix = -area / gs; ix <= area / gs; ix++) {
      for (let iz = -area / gs; iz <= area / gs; iz++) {
        const s = biomeSiteAt(ix, iz);
        for (const w of getZoneWalls(s, getBiomeGrid(s))) {
          if (w.a === w.b) continue;
          const key = [w.sx, w.sz, w.ex, w.ez].map(Math.round).sort().join();
          if (seen.has(key)) continue;
          seen.add(key);
          const len = Math.hypot(w.ex - w.sx, w.ez - w.sz);
          for (let t = 5; t < len; t += 10) {
            const px = w.sx + ((w.ex - w.sx) * t) / len;
            const pz = w.sz + ((w.ez - w.sz) * t) / len;
            const pa = { x: px - w.nx * 1e-4, z: pz - w.nz * 1e-4 };
            const pb = { x: px + w.nx * 1e-4, z: pz + w.nz * 1e-4 };
            if (getBiomeContext(pa).zone === getBiomeContext(pb).zone) continue;
            const a = unwarp(pa.x, pa.z);
            const b = unwarp(pb.x, pb.z);
            const va = computeVertexDataRaw(a.x, a.z);
            const ha = va.height;
            const cityA = va.biomeId === CITY_BIOME_ID;
            const riverA = va.distanceToRiverCenter < reach + 30;
            const vb = computeVertexDataRaw(b.x, b.z);
            crossings++;
            if ((cityA || vb.biomeId === CITY_BIOME_ID) && (riverA || vb.distanceToRiverCenter < reach + 30)) cityRiver++;
            worst = Math.max(worst, Math.abs(ha - vb.height));
          }
        }
      }
    }
    expect(crossings).toBeGreaterThan(10000);
    expect(cityRiver).toBeGreaterThan(50);
    expect(worst).toBeLessThan(0.1);
  });
});

describe("the riverbed's texture across a crisp wall", () => {
  it("is what a vertex in the bed's reach carries (a city|tundra wall crossing a river)", () => {
    // (-7028, 8642): the wall meets a river 24 factor-1 units from its centerline.
    const v = computeVertexDataRaw(-7028, 8642);
    expect(v.riverBedDistance).toBeLessThan(OVERWORLD_CONFIG.river.halfWidth + OVERWORLD_CONFIG.river.bank);
    const w = warp(-7028, 8642);
    const ctx = getBiomeContext(w);
    const sdf = Float64Array.from(v.biomeSdf);
    const bed = Float64Array.from(v.riverbedSdf);
    const out = new Float64Array(bed.length);
    riverbedSdfAt(w.x, w.z, ctx.zoneWalls, ctx.zone, sdf, out);
    expect(Array.from(bed)).toEqual(Array.from(out));
    expect(bed.some((b, i) => b !== sdf[i])).toBe(true);
  });

  it("cross-fades over its own soft width where the ground's material switches within 1u", () => {
    const slots = getBiomeSlots();
    const city = slots.indexOf(CITY_BIOME_ID);
    const bedHalves = riverbedSlotHalvesOf(OVERWORLD_CONFIG);
    // A city wall: walk out of a city cell until the biome changes.
    let at: { x: number; z: number } | null = null;
    for (let x = -6000; x <= 6000 && !at; x += 250) {
      for (let z = -6000; z <= 6000 && !at; z += 250) {
        const v = computeVertexDataRaw(x, z);
        if (v.biomeId === CITY_BIOME_ID && v.distanceToBiomeBoundaryCenter > 100) at = { x, z };
      }
    }
    expect(at).not.toBeNull();
    let prev = computeVertexDataRaw(at!.x, at!.z).biomeId;
    let wallX = NaN;
    for (let t = 0.5; t < 3000; t += 0.5) {
      const b = computeVertexDataRaw(at!.x + t, at!.z).biomeId;
      if (b !== prev) {
        wallX = at!.x + t - 0.25;
        break;
      }
      prev = b;
    }
    expect(Number.isNaN(wallX)).toBe(false);
    const out = new Float64Array(slots.length);
    const bedCity = (dx: number) => {
      const v = computeVertexDataRaw(wallX + dx, at!.z);
      const w = warp(wallX + dx, at!.z);
      const ctx = getBiomeContext(w);
      riverbedSdfAt(w.x, w.z, ctx.zoneWalls, ctx.zone, v.biomeSdf, out);
      return combineSlotWeights(out, bedHalves)[city];
    };
    // 4u inside and outside: the ground is all city / none, the bed's texture still mid-fade.
    expect(bedCity(-4)).toBeGreaterThan(0.6);
    expect(bedCity(-4)).toBeLessThan(0.98);
    expect(bedCity(4)).toBeGreaterThan(0.02);
    expect(bedCity(4)).toBeLessThan(0.4);
    expect(bedCity(-20)).toBeGreaterThan(0.99);
    expect(bedCity(20)).toBeLessThan(0.01);
  });
});
