/** The cross-fade contract (CLAUDE.md "Blending"): across ANY wall — biome or region,
 *  and at the junctions where three zones meet — heights are continuous, the material
 *  weights partition unity, a crisp biome's feather is exactly as wide as it says, and
 *  rivers/lakes carry a water surface. Run on the real overworld config. */
import { OVERWORLD_CONFIG } from "../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../world/constants";
import { LAKE_BIOME } from "../../world/domains/overworld/regions/ocean/biomes/lake/spec";
import {
  biomeSlotBlendHalvesOf,
  combineSlotWeights,
  computeVertexData,
  computeVertexDataRaw,
  getBiomeSlots,
  getPlaceInfo,
  initCompute,
  terrainOnlyAt,
  unwarp,
} from "./vertexCompute";
import { biomeSiteAt, getBiomeContext, getBiomeGrid, getZoneWalls } from "./voronoi";
import { biomeSdf, zoneFinal } from "./zoneBlend";

const HALVES = biomeSlotBlendHalvesOf(OVERWORLD_CONFIG);

/** Shader weights from a vertex's biomeSdf (the same crispness-tiered combination). */
const weightsOf = (sdf: ArrayLike<number>): number[] => combineSlotWeights(sdf, HALVES);

type VD = ReturnType<typeof computeVertexDataRaw>;

/** Walks a line from (x0,z0) toward (x1,z1) in `step`s and returns the first crossing where `changed` flips. */
const findCrossing = (
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  step: number,
  changed: (a: VD, b: VD) => boolean,
): { x: number; z: number; ux: number; uz: number } | null => {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ux = (x1 - x0) / len;
  const uz = (z1 - z0) / len;
  let prev = computeVertexDataRaw(x0, z0);
  for (let t = step; t <= len; t += step) {
    const cur = computeVertexDataRaw(x0 + ux * t, z0 + uz * t);
    if (changed(prev, cur)) return { x: x0 + ux * (t - step / 2), z: z0 + uz * (t - step / 2), ux, uz };
    prev = cur;
  }
  return null;
};

const regionChanged = (a: VD, b: VD) => a.regionId !== b.regionId;
const cityChanged = (a: VD, b: VD) => (a.biomeId === CITY_BIOME_ID) !== (b.biomeId === CITY_BIOME_ID);

beforeAll(() => initCompute(OVERWORLD_CONFIG));

describe("region edges", () => {
  it("heights and weights are continuous across a region wall, and the material weights sum to one", () => {
    // Radial scans from the origin: region cells are ~3000u, so 20k reaches several.
    let crossing: ReturnType<typeof findCrossing> = null;
    for (let angle = 0; angle < Math.PI * 2 && !crossing; angle += Math.PI / 7) {
      crossing = findCrossing(0, 0, Math.cos(angle) * 20000, Math.sin(angle) * 20000, 250, regionChanged);
    }
    expect(crossing).not.toBeNull();
    const { x, z, ux, uz } = crossing!;

    // Fine walk ±400u across it: consecutive 2u samples never jump more than a steep slope would.
    let prevH: number | null = null;
    const sawBothSides = new Set<number>();
    for (let t = -400; t <= 400; t += 2) {
      const vd = computeVertexDataRaw(x + ux * t, z + uz * t);
      sawBothSides.add(vd.regionId);
      if (prevH !== null) expect(Math.abs(vd.height - prevH)).toBeLessThan(8);
      prevH = vd.height;
      const w = weightsOf(vd.biomeSdf);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
      expect(vd.blend).toBeGreaterThan(0);
      expect(vd.blend).toBeLessThanOrEqual(1);
    }
    expect(sawBothSides.size).toBe(2);
  });

  it("the sky's region weights are normalized and hand over across the wall", () => {
    const coarse = findCrossing(0, 0, 20000, 8000, 250, regionChanged);
    expect(coarse).not.toBeNull();
    // Refine to ~1u: the sky windows are ±150u, so a 125u-off "wall" would still read one-sided.
    const crossing = findCrossing(
      coarse!.x - coarse!.ux * 130, coarse!.z - coarse!.uz * 130,
      coarse!.x + coarse!.ux * 130, coarse!.z + coarse!.uz * 130,
      1, regionChanged,
    );
    expect(crossing).not.toBeNull();
    const { x, z, ux, uz } = crossing!;
    const far = getPlaceInfo(x - ux * 2000, z - uz * 2000);
    const near = getPlaceInfo(x, z);
    for (const p of [far, near]) {
      expect(p.regionWeights.reduce((a, b) => a + b.weight, 0)).toBeCloseTo(1, 6);
    }
    const dominant = far.regionWeights.find((w) => w.id === far.regionId)!;
    expect(dominant.weight).toBeGreaterThan(0.95);
    // On the wall itself the two sides share the sky.
    const top = [...near.regionWeights].sort((a, b) => b.weight - a.weight);
    expect(top[0].weight).toBeLessThan(0.75);
  });
});

/** Every point where the city meets ANOTHER region, along straight scans of the map. */
const cityRegionEdges = (): { x: number; z: number; ux: number; uz: number }[] => {
  const out: { x: number; z: number; ux: number; uz: number }[] = [];
  for (let z = -30000; z <= 30000 && out.length < 6; z += 6000) {
    let prev = computeVertexDataRaw(-30000, z);
    for (let x = -30000 + 100; x <= 30000; x += 100) {
      const cur = computeVertexDataRaw(x, z);
      if (cityChanged(prev, cur) && regionChanged(prev, cur)) {
        const fine = findCrossing(x - 100, z, x, z, 0.5, cityChanged);
        if (fine) out.push(fine);
      }
      prev = cur;
    }
  }
  return out;
};

describe("the city edge", () => {
  it("is crisp: the city's material weight falls from ≥0.5 to ~0 within its 2u feather, with no boundary band", () => {
    const citySlot = getBiomeSlots().indexOf(CITY_BIOME_ID);
    expect(citySlot).toBeGreaterThanOrEqual(0);
    let cityAt: { x: number; z: number } | null = null;
    for (let x = -12000; x <= 12000 && !cityAt; x += 250) {
      for (let z = -12000; z <= 12000 && !cityAt; z += 250) {
        const vd = computeVertexDataRaw(x, z);
        if (vd.biomeId === CITY_BIOME_ID && vd.distanceToBiomeBoundaryCenter > 200) cityAt = { x, z };
      }
    }
    expect(cityAt).not.toBeNull();
    const crossing = findCrossing(cityAt!.x, cityAt!.z, cityAt!.x + 4000, cityAt!.z + 1700, 10, cityChanged);
    expect(crossing).not.toBeNull();
    const { x, z, ux, uz } = crossing!;
    const fine = findCrossing(x - ux * 5, z - uz * 5, x + ux * 5, z + uz * 5, 0.1, cityChanged)!;
    // biomeSdf is a SHARED scratch buffer — read each sample's weights before the next call.
    const cityIn = weightsOf(computeVertexDataRaw(fine.x - fine.ux * 3, fine.z - fine.uz * 3).biomeSdf)[citySlot];
    const cityOut = weightsOf(computeVertexDataRaw(fine.x + fine.ux * 3, fine.z + fine.uz * 3).biomeSdf)[citySlot];
    expect(cityIn).toBeGreaterThan(0.98);
    expect(cityOut).toBeLessThan(0.02);
    const onWall = weightsOf(computeVertexDataRaw(fine.x, fine.z).biomeSdf)[citySlot];
    expect(onWall).toBeGreaterThan(0.3);
    expect(onWall).toBeLessThan(0.7);
  });

  it("meets other regions without a step, including where a third zone's wall is near (junctions)", () => {
    const edges = cityRegionEdges();
    expect(edges.length).toBeGreaterThan(0);
    for (const { x, z, ux, uz } of edges) {
      const inside = computeVertexDataRaw(x - ux * 3, z - uz * 3).height;
      const outside = computeVertexDataRaw(x + ux * 3, z + uz * 3).height;
      expect(Math.abs(inside - outside)).toBeLessThan(0.5);
      let prev: number | null = null;
      for (let t = -150; t <= 150; t += 2) {
        const vd = computeVertexDataRaw(x + ux * 2 - uz * t, z + uz * 2 + ux * t);
        // A river channel (and the ground cut under a deck) is steep by design.
        if (vd.distanceToRiverCenter < OVERWORLD_CONFIG.river.halfWidth + OVERWORLD_CONFIG.river.bank) {
          prev = null;
          continue;
        }
        if (prev !== null) expect(Math.abs(vd.height - prev)).toBeLessThan(2.5);
        prev = vd.height;
      }
    }
  });

  it("returns the vertex's OWN biome distances even when a flatten tile is built mid-call (cold caches)", () => {
    initCompute(OVERWORLD_CONFIG); // cold: every flatten tile below is built inside these calls
    const edges = cityRegionEdges();
    const citySlot = getBiomeSlots().indexOf(CITY_BIOME_ID);
    let checked = 0;
    for (const { x, z, ux, uz } of edges.slice(0, 3)) {
      for (let d = 4; d <= 240; d += 4) {
        const vd = computeVertexData(x - ux * d, z - uz * d); // PADDED path, inside the city
        if (vd.biomeId !== CITY_BIOME_ID) continue;
        expect(Array.from(vd.biomeSdf)[citySlot]).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});

/** Every voronoi vertex of the biome grid in ±area (warped space) where 3+ zones meet, with the
 *  directions of the walls leaving it. */
const junctionsIn = (area: number) => {
  const gs = OVERWORLD_CONFIG.gridSize;
  const byKey = new Map<string, { x: number; z: number; zones: Set<number>; walls: { ux: number; uz: number; nx: number; nz: number; len: number }[] }>();
  for (let ix = -area / gs; ix <= area / gs; ix++) {
    for (let iz = -area / gs; iz <= area / gs; iz++) {
      const s = biomeSiteAt(ix, iz);
      for (const w of getZoneWalls(s, getBiomeGrid(s))) {
        // Only the window's trusted middle (its outer Delaunay is distorted).
        if (Math.abs(w.sx - s.x) > gs * 1.5 || Math.abs(w.sz - s.z) > gs * 1.5) continue;
        const key = `${Math.round(w.sx)},${Math.round(w.sz)}`;
        let j = byKey.get(key);
        if (!j) byKey.set(key, (j = { x: w.sx, z: w.sz, zones: new Set(), walls: [] }));
        j.zones.add(w.a.index);
        j.zones.add(w.b.index);
        const len = Math.hypot(w.ex - w.sx, w.ez - w.sz);
        const ux = (w.ex - w.sx) / len;
        if (!j.walls.some((o) => Math.abs(o.ux - ux) < 1e-6)) j.walls.push({ ux, uz: (w.ez - w.sz) / len, nx: w.nx, nz: w.nz, len });
      }
    }
  }
  return [...byKey.values()].filter((j) => j.zones.size >= 3);
};

/** Both sides of every wall leaving a junction, 1e-4u from it, at points out to 300u along it —
 *  where a junction's third zone used to make the field jump. */
const junctionCrossings = (area: number, step: number) => {
  const out: { a: { x: number; z: number }; b: { x: number; z: number } }[] = [];
  const E = 1e-4;
  for (const j of junctionsIn(area)) {
    for (const w of j.walls) {
      for (let t = 2; t < Math.min(w.len, 300); t += step) {
        const px = j.x + w.ux * t;
        const pz = j.z + w.uz * t;
        // A wall bounding a joined zone's own cells crosses nothing.
        if (getBiomeContext({ x: px - w.nx * E, z: pz - w.nz * E }).zone === getBiomeContext({ x: px + w.nx * E, z: pz + w.nz * E }).zone) continue;
        out.push({ a: unwarp(px - w.nx * E, pz - w.nz * E), b: unwarp(px + w.nx * E, pz + w.nz * E) });
      }
    }
  }
  return out;
};

describe("junctions of three or more zones", () => {
  it("hold every height weight, material weight and the blended height continuous across each wall leaving them", () => {
    const junctions = junctionsIn(5000);
    // Every mix shows up: the crisp city, soft biomes, other regions and water, and corners of four.
    const kinds = new Set(junctions.map((j) => [...j.zones].sort().join()));
    expect(kinds.size).toBeGreaterThan(15);
    const quads = junctions.filter((j) => {
      const near = new Set(j.zones);
      for (const o of junctions) if (Math.hypot(o.x - j.x, o.z - j.z) < 300) o.zones.forEach((z) => near.add(z));
      return near.size >= 4;
    });
    expect(quads.length).toBeGreaterThan(0);

    const crossings = junctionCrossings(5000, 11);
    expect(crossings.length).toBeGreaterThan(5000);
    let worstHeight = 0;
    let worstWeight = 0;
    let worstMaterial = 0;
    for (const { a, b } of crossings) {
      const ha = terrainOnlyAt(a.x, a.z);
      const wa = Array.from(zoneFinal);
      const ma = weightsOf(biomeSdf);
      const hb = terrainOnlyAt(b.x, b.z);
      const mb = weightsOf(biomeSdf);
      worstHeight = Math.max(worstHeight, Math.abs(ha - hb));
      for (let k = 0; k < wa.length; k++) worstWeight = Math.max(worstWeight, Math.abs(wa[k] - zoneFinal[k]));
      for (let k = 0; k < ma.length; k++) worstMaterial = Math.max(worstMaterial, Math.abs(ma[k] - mb[k]));
      expect(ma.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    }
    // Before the edge floor: 0.27 of weight and 14u of height across these walls.
    expect(worstWeight).toBeLessThan(1e-3);
    expect(worstMaterial).toBeLessThan(1e-3);
    expect(worstHeight).toBeLessThan(0.01);
  });

  it("with a river in reach, the carved terrain stays continuous across them too", () => {
    const rv = OVERWORLD_CONFIG.river;
    let withRiver = 0;
    let withCity = 0;
    for (const { a, b } of junctionCrossings(8000, 7)) {
      const va = computeVertexDataRaw(a.x, a.z);
      const ha = va.height;
      const inReach = va.distanceToRiverCenter < rv.halfWidth + rv.bank;
      const cityA = va.biomeId === CITY_BIOME_ID;
      const vb = computeVertexDataRaw(b.x, b.z);
      if (!inReach && !(vb.distanceToRiverCenter < rv.halfWidth + rv.bank)) continue;
      withRiver++;
      // A city wall too: its river side (the quay, a drowned belt) meets the neighbor's (seams.test.ts).
      if (cityA || vb.biomeId === CITY_BIOME_ID) withCity++;
      expect(Math.abs(ha - vb.height)).toBeLessThan(0.05);
    }
    expect(withRiver).toBeGreaterThan(200);
    expect(withCity).toBeGreaterThan(20);
  });
});

describe("presence", () => {
  it("a soft biome shows the region base at its own edge and takes over one blend width inside", () => {
    // A non-city, non-water biome wall: presence rises from ~0 at the wall.
    let found: { x: number; z: number; ux: number; uz: number; slot: number } | null = null;
    for (let z = -20000; z <= 20000 && !found; z += 5000) {
      let prev = computeVertexDataRaw(-20000, z);
      for (let x = -20000 + 50; x <= 20000 && !found; x += 50) {
        const cur = computeVertexDataRaw(x, z);
        if (prev.biomeId !== cur.biomeId && cur.biomeId !== CITY_BIOME_ID && cur.biomeId !== LAKE_BIOME.id && prev.biomeId !== CITY_BIOME_ID) {
          const fine = findCrossing(x - 50, z, x, z, 0.5, (a, b) => a.biomeId !== b.biomeId);
          if (fine) found = { ...fine, slot: getBiomeSlots().indexOf(cur.biomeId) };
        }
        prev = cur;
      }
    }
    expect(found).not.toBeNull();
    const { x, z, ux, slot } = found!;
    const near = computeVertexDataRaw(x + ux * 2, z).biomePresence[slot];
    expect(near).toBeGreaterThanOrEqual(0);
    expect(near).toBeLessThan(0.1); // ≈ 2u / width
    const deep = computeVertexDataRaw(x + ux * 600, z);
    if (deep.biomeId === getBiomeSlots()[slot]) expect(deep.biomePresence[slot]).toBeGreaterThan(0.9);
  });
});

describe("water", () => {
  it("lakes carry a flat surface above their bed and rivers carve a channel under theirs", () => {
    // Find a lake cell.
    let lake: VD | null = null;
    let lx = 0;
    let lz = 0;
    for (let x = -30000; x <= 30000 && !lake; x += 250) {
      for (let z = -30000; z <= 30000 && !lake; z += 250) {
        const vd = computeVertexDataRaw(x, z);
        if (vd.biomeId === LAKE_BIOME.id && vd.distanceToBiomeBoundaryCenter > 150) {
          lake = vd;
          lx = x;
          lz = z;
        }
      }
    }
    expect(lake).not.toBeNull();
    expect(Number.isNaN(lake!.waterHeight)).toBe(false);
    expect(lake!.waterHeight).toBeGreaterThan(lake!.height + 5);
    // The level is a distance-weighted blend of nearby lake cells: near-flat across a cell
    // (a gentle tilt, never a step) and continuous between two lake cells of one body.
    const other = computeVertexDataRaw(lx + 100, lz);
    if (other.biomeId === LAKE_BIOME.id && other.distanceToBiomeBoundaryCenter > 50) expect(Math.abs(other.waterHeight - lake!.waterHeight)).toBeLessThan(0.5);
    let prev = lake!.waterHeight;
    for (let d = 2; d <= 600; d += 2) {
      const vd = computeVertexDataRaw(lx + d, lz);
      if (Number.isNaN(vd.waterHeight) || Number.isNaN(prev)) break;
      expect(Math.abs(vd.waterHeight - prev)).toBeLessThan(0.1); // 2u steps: no wall of water anywhere
      prev = vd.waterHeight;
    }

    // Find a river: a point within the half-width of a river centerline.
    let river: VD | null = null;
    for (let z = -30000; z <= 30000 && !river; z += 3000) {
      for (let x = -30000; x <= 30000 && !river; x += 40) {
        const vd = computeVertexDataRaw(x, z);
        if (vd.distanceToRiverCenter < OVERWORLD_CONFIG.river.halfWidth * 0.5 && vd.biomeId !== LAKE_BIOME.id) river = vd;
      }
    }
    expect(river).not.toBeNull();
    expect(Number.isNaN(river!.waterHeight)).toBe(false);
    expect(river!.waterHeight).toBeGreaterThan(river!.height + 1);
  });
});
