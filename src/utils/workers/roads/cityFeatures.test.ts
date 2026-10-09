/** Smoke tests for the city feature enumerators — determinism, chunk-split dedupe,
 *  placement validity — on the REAL compute module with the overworld's shared config. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../../world/constants";
import { GRASS_BIOME } from "../../../world/domains/overworld/regions/city/biomes/grass/spec";
import {
  computeVertexData,
  computeVertexDataRaw,
  getCityFreewaySidePoints,
  getCityRoadMarkers,
  getCityTrafficLightPoints,
  getFlattenPoints,
  getFreewayBridges,
  getNetwork,
  getRiverSegments,
  initCompute,
  unwarp,
} from "../vertexCompute";
import { BRIDGE_PLACEMENT, bridgeColliderPoints, bridgePierColumns } from "../../../objects/dressing/bridges/bridgeSpec";
import { DRESSING_COLLIDER_SPECS } from "../../../objects/dressing/catalog";
import { DRESSING_ENUMERATORS, runDressingEnumerator } from "../../../objects/dressing/enumerators";
import { UTILITY_POLE_PLACEMENT } from "../../../objects/dressing/power-lines/poleSpec";
import { BRIDGE_CUT_BELOW_TOP, BRIDGE_DECK_LIFT } from "../bridges/constants";
import type { FreewayBridge } from "../bridges/types";

const config = OVERWORLD_CONFIG;
const CITY = config.cityConfig;

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;

/** A landed end's deck LINE stands BRIDGE_DECK_LIFT over the road (its ramp takes the drawn slab
 *  down under the road — bridgeSpec.test.ts), within the cut just below its top
 *  (BRIDGE_CUT_BELOW_TOP) — a T-child's up to a step of the character autostep more (0.5u,
 *  BRIDGE_MAX_END_LIFT) so the deck clears the water (a child needing more arches between its ends
 *  instead, and lands on the road). */
const expectOnRoad = (b: FreewayBridge, deckY: number, roadY: number, which: 0 | 1) => {
  // A landed end cut along the road's edge starts flush with the road there instead:
  // its drawn end section's corners lie on the road (bridgeSpec.test.ts checks them).
  if (b.landings?.[which] && (which === 0 ? b.trimStartAxis : b.trimEndAxis)) return;
  const over = deckY - roadY - BRIDGE_DECK_LIFT;
  expect(over).toBeGreaterThan(-1e-9);
  if (b.trimStart === undefined && b.trimEnd === undefined) expect(over).toBeLessThan(BRIDGE_CUT_BELOW_TOP + 1e-9);
  else expect(over).toBeLessThan(0.5 + BRIDGE_CUT_BELOW_TOP + 1e-9);
};

/** Center of a reasonably deep city area / grass area (found by coarse scan). */
let cx = 0;
let cz = 0;
let gx = 0;
let gz = 0;

beforeAll(() => {
  initCompute(config);
  let best = -Infinity;
  let bestGrass = -Infinity;
  for (let x = -6000; x <= 6000; x += 200) {
    for (let z = -6000; z <= 6000; z += 200) {
      // Raw variant: a coarse world scan would otherwise compute a pad tile
      // per lonely sample.
      const vd = computeVertexDataRaw(x, z);
      if (vd.biomeId === CITY_BIOME_ID && vd.distanceToBiomeBoundaryCenter > best) {
        best = vd.distanceToBiomeBoundaryCenter;
        cx = x;
        cz = z;
      }
      if (vd.biomeId === GRASS_BIOME.id && vd.distanceToBiomeBoundaryCenter > bestGrass) {
        bestGrass = vd.distanceToBiomeBoundaryCenter;
        gx = x;
        gz = z;
      }
    }
  }
  expect(best).toBeGreaterThan(100); // found a city interior to test in
  expect(bestGrass).toBeGreaterThan(100); // and a grass interior
});

describe("getCityTrafficLightPoints", () => {
  const R = 512;

  it("finds intersections, places poles on sidewalk corners, and dedupes across chunk splits", () => {
    const whole = getCityTrafficLightPoints(cx - R, cz - R, cx + R, cz + R, 1);
    expect(whole.length).toBeGreaterThan(0);

    // Same area enumerated as 4 quadrant chunks → identical point set.
    const parts = [
      ...getCityTrafficLightPoints(cx - R, cz - R, cx, cz, 1),
      ...getCityTrafficLightPoints(cx, cz - R, cx + R, cz, 1),
      ...getCityTrafficLightPoints(cx - R, cz, cx, cz + R, 1),
      ...getCityTrafficLightPoints(cx, cz, cx + R, cz + R, 1),
    ];
    expect(new Set(parts.map(key)).size).toBe(parts.length); // no duplicates
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());

    for (const p of whole) {
      const vd = computeVertexData(p.x, p.z);
      expect(vd.biomeId).toBe(CITY_BIOME_ID);
      expect(vd.height).toBeCloseTo(p.y, 5);
      // Sidewalk band of the road field (poles never stand on asphalt).
      expect(vd.distanceToRoadCenter).toBeGreaterThanOrEqual(8.4);
      expect(vd.distanceToRoadCenter).toBeLessThanOrEqual(11.6);
      expect(Math.hypot(p.dirX, p.dirZ)).toBeCloseTo(1, 5);
      expect(p.phase).toBeGreaterThanOrEqual(0);
      expect(p.phase).toBeLessThan(1);
    }
  });

  it("respects the chance roll (0 → nothing)", () => {
    expect(getCityTrafficLightPoints(cx - R, cz - R, cx + R, cz + R, 0)).toHaveLength(0);
  });
});

describe("flatten-ground pads", () => {
  it("terrain is flat under every flatten-ground instance, at its exact spawn height", () => {
    const points = getFlattenPoints(cx - 400, cz - 400, cx + 400, cz + 400);
    expect(points.length).toBeGreaterThan(0);

    for (const p of points.slice(0, 5)) {
      const h0 = computeVertexData(p.x, p.z).height;
      // The pad height IS the point's spawn height — actors sit exactly on it.
      expect(h0).toBeCloseTo(p.y, 3);
      // Flat across the pad radius.
      const r = p.radius * 0.7;
      for (const [dx, dz] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
        [r * 0.7, r * 0.7],
      ]) {
        expect(computeVertexData(p.x + dx, p.z + dz).height).toBeCloseTo(h0, 2);
      }
    }
  });

  it("pads work in ANY biome — grass-biome houses level the rolling terrain", () => {
    const points = getFlattenPoints(gx - 500, gz - 500, gx + 500, gz + 500).filter(
      (p) => p.descId === "house"
    );
    expect(points.length).toBeGreaterThan(0);
    const p = points[0];
    const h0 = computeVertexData(p.x, p.z).height;
    expect(h0).toBeCloseTo(p.y, 3);
    const r = p.radius * 0.7;
    for (const [dx, dz] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      expect(computeVertexData(p.x + dx, p.z + dz).height).toBeCloseTo(h0, 2);
    }
  });

  it("points are deterministic and duplicate-free across bounds splits", () => {
    const R = 256;
    const whole = getFlattenPoints(cx - R, cz - R, cx + R, cz + R);
    const parts = [
      ...getFlattenPoints(cx - R, cz - R, cx, cz),
      ...getFlattenPoints(cx, cz - R, cx + R, cz),
      ...getFlattenPoints(cx - R, cz, cx, cz + R),
      ...getFlattenPoints(cx, cz, cx + R, cz + R),
    ];
    expect(parts.map(key).sort()).toEqual(whole.map(key).sort());
    expect(new Set(parts.map(key)).size).toBe(parts.length);
    for (let i = 0; i < whole.length; i++) {
      for (let j = i + 1; j < whole.length; j++) {
        const d = Math.hypot(whole[i].x - whole[j].x, whole[i].z - whole[j].z);
        expect(d).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

describe("getCityRoadMarkers", () => {
  it("never emits street/arterial markers beyond the belt freeway", () => {
    // Window sized to reach past the city cell's rim, so the strip between
    // the belt and the biome boundary is covered.
    const R = 700;
    const points = getCityRoadMarkers(cx - R, cz - R, cx + R, cz + R, 9, 11);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      const d = computeVertexData(p.x, p.z).distanceToBiomeBoundaryCenter;
      // Belt MEDIAN markers sit on the belt centerline — the wall itself; everything
      // else must be strictly inside the ring. Nothing may sit in the strip
      // beyond the belt.
      expect(d).toBeGreaterThan(-3);
    }
  });
});

describe("getCityFreewaySidePoints", () => {
  const R = 760; // > half a district pitch — guarantees arterials in range
  const SPACING = 6;
  const LATERAL = CITY.freewayWidth + 1.3;
  const CLEAR = 12;

  it("emits points beside freeways, off the road surface, deduped across chunk splits", () => {
    const whole = getCityFreewaySidePoints(
      cx - R, cz - R, cx + R, cz + R, SPACING, LATERAL, CLEAR, false
    );
    expect(whole.length).toBeGreaterThan(0);

    const parts = [
      ...getCityFreewaySidePoints(cx - R, cz - R, cx, cz, SPACING, LATERAL, CLEAR, false),
      ...getCityFreewaySidePoints(cx, cz - R, cx + R, cz, SPACING, LATERAL, CLEAR, false),
      ...getCityFreewaySidePoints(cx - R, cz, cx, cz + R, SPACING, LATERAL, CLEAR, false),
      ...getCityFreewaySidePoints(cx, cz, cx + R, cz + R, SPACING, LATERAL, CLEAR, false),
    ];
    // Disjoint queries can NEVER duplicate (ownership by position) …
    expect(new Set(parts.map(key)).size).toBe(parts.length);

    // … and ARTERIAL points are exactly reproducible under any chunk split.
    // BELT points depend on the wall set visible from the query center (the
    // same caveat as the belt median markers), so different window sizes may
    // see slightly different belt coverage — classify by distance to the
    // biome boundary and compare arterial subsets only. Arterial points sit
    // ≥ freewayWidth + junctionClear from the belt corridor; belt points at
    // exactly lateral from it — clean separation at 20.
    const vdOf = (p: { x: number; z: number }) => computeVertexData(p.x, p.z);
    const isArterial = (p: { x: number; z: number }) =>
      vdOf(p).distanceToBiomeBoundaryCenter > 20;
    expect(parts.filter(isArterial).map(key).sort()).toEqual(
      whole.filter(isArterial).map(key).sort()
    );

    const freewayToStreetScale = CITY.roadWidth / CITY.freewayWidth;
    for (const p of whole) {
      const vd = vdOf(p);
      expect(vd.biomeId).toBe(CITY_BIOME_ID);
      expect(vd.height).toBeCloseTo(p.y, 5);
      expect(vd.distanceToRoadCenter).toBeGreaterThanOrEqual(LATERAL * freewayToStreetScale - 1.5);
      expect(Math.hypot(p.dirX, p.dirZ)).toBeCloseTo(1, 5);
      expect(Math.abs(p.side)).toBe(1);
    }
  });

  it("links each point to its emitted successor (wire spans survive chunk borders)", () => {
    const POLE_SPACING = 55;
    const whole = getCityFreewaySidePoints(
      cx - R, cz - R, cx + R, cz + R, POLE_SPACING, CITY.freewayWidth + 5, 26, true
    );
    expect(whole.length).toBeGreaterThan(0);
    const keys = new Set(whole.map(key));
    let linked = 0;
    for (const p of whole) {
      if (!p.next) continue;
      linked++;
      // A successor inside the queried bounds must be one of the emitted points.
      const inBounds =
        p.next.x >= cx - R && p.next.x < cx + R && p.next.z >= cz - R && p.next.z < cz + R;
      if (inBounds) expect(keys.has(key(p.next))).toBe(true);
      // Spans are roughly one lattice step long.
      const span = Math.hypot(p.next.x - p.x, p.next.z - p.z);
      expect(span).toBeGreaterThan(POLE_SPACING * 0.5);
      expect(span).toBeLessThan(POLE_SPACING * 1.5);
    }
    expect(linked).toBeGreaterThan(0);
  });
});

describe("getFreewayBridges", () => {
  const CHUNK = 256;

  it("spans every river an inter-city run crosses: deterministic, chunk-owned, ends on graded road over open channel", () => {
    // Find where an inter-city run crosses a river-grid segment, then enumerate the dressing chunks
    // around each crossing. Rivers are sparse (per-region density, none on high ground), so the
    // search walks square rings of networks outward from the city — each network covers a wide
    // window, and each only claims the run legs starting in its own RING × RING square.
    const RING = 2500;
    const crossingChunks = new Set<string>();
    for (let r = 0; r <= 5 && crossingChunks.size < 12; r++) {
      for (let ix = -r; ix <= r; ix++) {
        for (let iz = -r; iz <= r; iz++) {
          if (Math.max(Math.abs(ix), Math.abs(iz)) !== r || crossingChunks.size >= 12) continue;
          const wx = cx + ix * RING;
          const wz = cz + iz * RING;
          const n = getNetwork({ x: wx, z: wz });
          for (const f of n.freeways) {
            for (let k = 0; k + 3 < f.pts.length; k += 2) {
              const sx = f.pts[k];
              const sz = f.pts[k + 1];
              if (Math.abs(sx - wx) > RING / 2 || Math.abs(sz - wz) > RING / 2) continue;
              const rivers = getRiverSegments({ x: sx, z: sz });
              const dx = f.pts[k + 2] - sx;
              const dz = f.pts[k + 3] - sz;
              for (const rv of rivers) {
                const rdx = rv.ex - rv.sx;
                const rdz = rv.ez - rv.sz;
                const denom = dx * rdz - dz * rdx;
                if (Math.abs(denom) < 1e-9) continue;
                const t = ((rv.sx - sx) * rdz - (rv.sz - sz) * rdx) / denom;
                const u = ((rv.sx - sx) * dz - (rv.sz - sz) * dx) / denom;
                if (t < 0 || t > 1 || u < 0 || u > 1) continue;
                const px = sx + dx * t;
                const pz = sz + dz * t;
                for (const [ox, oz] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
                  crossingChunks.add(`${Math.floor(px / CHUNK) + ox},${Math.floor(pz / CHUNK) + oz}`);
                }
              }
            }
          }
        }
      }
    }
    expect(crossingChunks.size).toBeGreaterThan(0);
    const bridges = [];
    for (const key of crossingChunks) {
      const [gx, gz] = key.split(",").map(Number);
      {
        const minX = gx * CHUNK;
        const minZ = gz * CHUNK;
        const found = getFreewayBridges(minX, minZ, minX + CHUNK, minZ + CHUNK, BRIDGE_PLACEMENT);
        expect(getFreewayBridges(minX, minZ, minX + CHUNK, minZ + CHUNK, BRIDGE_PLACEMENT)).toEqual(found);
        for (const b of found) {
          expect(b.x).toBeGreaterThanOrEqual(minX);
          expect(b.x).toBeLessThan(minX + CHUNK);
          expect(b.z).toBeGreaterThanOrEqual(minZ);
          expect(b.z).toBeLessThan(minZ + CHUNK);
        }
        bridges.push(...found);
      }
    }
    expect(bridges.length).toBeGreaterThan(0);
    expect(new Set(bridges.map(key)).size).toBe(bridges.length);

    const river = config.river;
    for (const b of bridges) {
      // Both abutments stand on graded freeway clear of the channel (or stop at the city wall,
      // where the belt lanes take over); the midpoint is over the river.
      for (const [x, z, y, which] of [[b.sx, b.sz, b.sy, 0], [b.ex, b.ez, b.ey, 1]] as const) {
        const vd = computeVertexData(x, z);
        // An end still inside the river's footprint is a JUNCTION with another deck (a hub, a belt
        // corner): it sits at the structure's shared height, not on the ground.
        if (vd.distanceToRiverCenter < river.halfWidth + river.bank) continue;
        expectOnRoad(b, y, vd.height, which);
        const atCityWall = vd.biomeId === CITY_BIOME_ID || vd.distanceToBiomeBoundaryCenter < CITY.freewayWidth + 3;
        if (atCityWall) continue;
        // On the road surface (the normalized road field; the lane-paint distance is blanked in a merge).
        expect(vd.distanceToRoadCenter).toBeLessThan(2);
      }
      // Somewhere along the deck the road is over the channel (a deck clipped at the belt's
      // curb, or one merged from two crossings, need not be centered on the river).
      let overWater = false;
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const pt = b.path.find((p) => p.t >= t) ?? b.path[b.path.length - 1];
        const prev = b.path[Math.max(0, b.path.indexOf(pt) - 1)];
        const f = pt.t === prev.t ? 0 : (t - prev.t) / (pt.t - prev.t);
        const vd = computeVertexData(prev.x + (pt.x - prev.x) * f, prev.z + (pt.z - prev.z) * f);
        if (vd.distanceToRiverCenter < river.halfWidth + river.bank && vd.height < Math.max(b.sy, b.ey)) overWater = true;
      }
      expect(overWater).toBe(true);
      // Width factors run from ~0.75 (a jittered junction) down to a fizzle end, so the deck can be far shorter than a factor-1 channel.
      expect(b.length).toBeGreaterThan(river.halfWidth * 0.5);
      // A viaduct along a river is one deck; the generator only builds chains that fit its window.
      expect(b.length).toBeLessThan(3000);
      const segs = bridgeColliderPoints(b);
      // A T-branch deck trimmed back to its host's edge can be only a few chords long.
      expect(segs.length).toBeGreaterThan(0);
      // Columns stand in the channel, below the deck; a foot on a bank the deck barely clears is dropped.
      const columns = bridgePierColumns(b);
      if (b.length >= 3 * BRIDGE_PLACEMENT.pierSpacing) expect(columns.length).toBeGreaterThan(0);
      for (const c of columns) expect(c.topY - c.groundY).toBeGreaterThan(0.5);
    }
  });
});

describe("rivers through the city", () => {
  /** First river piece (river grid, warped) whose midpoint and both flanks 200u out are city. */
  const findInteriorCrossing = () => {
    const gs = 2800;
    for (let ix = -2; ix <= 1; ix++) {
      for (let iz = -2; iz <= 1; iz++) {
        const q = { x: 1237 + gs * (ix + 0.5), z: 811 + gs * (iz + 0.5) };
        for (const s of getRiverSegments(q)) {
          const mx = (s.sx + s.ex) / 2;
          const mz = (s.sz + s.ez) / 2;
          if (Math.abs(mx - q.x) > gs / 2 || Math.abs(mz - q.z) > gs / 2) continue;
          const dx = s.ex - s.sx;
          const dz = s.ez - s.sz;
          const l = Math.hypot(dx, dz) || 1;
          const nx = -dz / l;
          const nz = dx / l;
          const mid = unwarp(mx, mz);
          const a = unwarp(mx + nx * 200, mz + nz * 200);
          const b = unwarp(mx - nx * 200, mz - nz * 200);
          if ([mid, a, b].every((p) => computeVertexDataRaw(p.x, p.z).biomeId === CITY_BIOME_ID)) return { mid, nx, nz, w: (s.w0 + s.w1) / 2 };
        }
      }
    }
    return null;
  };

  it("carves the channel under a quay road on each bank and keeps the strip between them off-limits to blocks", () => {
    const c = findInteriorCrossing();
    expect(c).not.toBeNull();
    if (!c) return;
    const river = config.river;
    const quay = (river.halfWidth + river.bank) * c.w + CITY.roadWidth;
    let underwater = 0;
    let quayHits = 0;
    const surface = computeVertexData(c.mid.x, c.mid.z).waterHeight;
    expect(Number.isNaN(surface)).toBe(false);
    for (const side of [1, -1]) {
      let minAtQuay = Infinity;
      for (let d = 0; d <= quay + 40; d += 2) {
        const vd = computeVertexData(c.mid.x + c.nx * d * side, c.mid.z + c.nz * d * side);
        const riverReal = vd.distanceToRiverCenter * c.w;
        // Between the channel and the quay's inner curb nothing can be placed: every placement
        // filter rejects the river's footprint (the field itself is uncapped there, see CITY_QUAY_INNER_CAP).
        if (riverReal < quay - CITY.roadWidth) expect(vd.distanceToRiverCenter).toBeLessThan(river.halfWidth + river.bank);
        // Within 10u: the quay is offset by riverQuayAt's smoothed width factor, not the segment's (7.9u
        // past it here, where only the old all-road rim cells used to put a road at the segment's offset).
        if (Math.abs(riverReal - quay) < 10) minAtQuay = Math.min(minAtQuay, vd.distanceToRoadCenter);
        if (!Number.isNaN(vd.waterHeight) && vd.height < vd.waterHeight) underwater++;
        // The quay road and everything behind it stand above the river's surface.
        if (riverReal >= quay - CITY.roadWidth) expect(vd.height).toBeGreaterThan(surface);
      }
      if (minAtQuay < 3) quayHits++;
    }
    expect(underwater).toBeGreaterThan(5); // the channel is really water
    expect(quayHits).toBe(2); // a road centerline at the quay offset on both banks
  });

  it("bridges the belt and arterials the river crosses, deterministically, ending on road or a hanging junction", () => {
    const c = findInteriorCrossing();
    expect(c).not.toBeNull();
    if (!c) return;
    const CHUNK = 256;
    const river = config.river;
    const reach = river.halfWidth + river.bank;
    const g0x = Math.floor(c.mid.x / CHUNK) - 4;
    const g0z = Math.floor(c.mid.z / CHUNK) - 4;
    const found = [];
    for (let gx = g0x; gx < g0x + 9; gx++) {
      for (let gz = g0z; gz < g0z + 9; gz++) {
        const minX = gx * CHUNK;
        const minZ = gz * CHUNK;
        const b = getFreewayBridges(minX, minZ, minX + CHUNK, minZ + CHUNK, BRIDGE_PLACEMENT);
        expect(getFreewayBridges(minX, minZ, minX + CHUNK, minZ + CHUNK, BRIDGE_PLACEMENT)).toEqual(b);
        found.push(...b);
      }
    }
    const inCity = found.filter((b) => computeVertexDataRaw(b.x, b.z).biomeId === CITY_BIOME_ID);
    expect(inCity.length).toBeGreaterThan(0);
    expect(new Set(found.map(key)).size).toBe(found.length);
    for (const b of inCity) {
      for (const [x, z, y, which] of [[b.sx, b.sz, b.sy, 0], [b.ex, b.ez, b.ey, 1]] as const) {
        const vd = computeVertexDataRaw(x, z);
        if (vd.distanceToRiverCenter < reach) continue; // an attached end inside the channel
        expectOnRoad(b, y, computeVertexData(x, z).height, which);
        // On the road or on the quay's pavement at the bank's edge (the field is capped at the plaza band there).
        expect(vd.distanceToRoadCenter).toBeLessThan(12.5);
      }
    }
  });
});

describe("dressing enumerator table", () => {
  const CHUNK = 256;
  const chunkAt = (x: number, z: number) => {
    const minX = Math.floor(x / CHUNK) * CHUNK;
    const minZ = Math.floor(z / CHUNK) * CHUNK;
    return { minX, minZ, maxX: minX + CHUNK, maxZ: minZ + CHUNK };
  };

  it("runs the same enumerators the direct calls do", () => {
    const b = chunkAt(cx, cz);
    expect(runDressingEnumerator("trafficLights", b, { chance: 0.45 })).toEqual(
      getCityTrafficLightPoints(b.minX, b.minZ, b.maxX, b.maxZ, 0.45)
    );
    const p = UTILITY_POLE_PLACEMENT;
    expect(runDressingEnumerator("freewayEdgePoints", b, { ...p, withNext: true })).toEqual(
      getCityFreewaySidePoints(b.minX, b.minZ, b.maxX, b.maxZ, p.spacing, CITY.freewayWidth + p.lateralMargin, p.junctionClear, true).filter(
        (q) => q.side === p.side
      )
    );
  });

  it("every collider spec names a table entry and yields bodies with parts to build", () => {
    for (const spec of DRESSING_COLLIDER_SPECS) {
      expect(Object.keys(DRESSING_ENUMERATORS)).toContain(spec.enumerator);
      for (const point of runDressingEnumerator(spec.enumerator, chunkAt(cx, cz), spec.placement)) {
        for (const body of spec.bodiesOf(point)) expect((body.parts ?? spec.colliderParts).length).toBeGreaterThan(0);
      }
    }
  });

  const GRASS_DENSITY = { seedTag: "test-grass-density", density: 300, footprint: 12, biomeIds: [GRASS_BIOME.id] };

  it("densityPoints places in whatever biomes its params name (the chunk probe follows biomeIds)", () => {
    const points = runDressingEnumerator("densityPoints", chunkAt(gx, gz), GRASS_DENSITY);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(computeVertexData(p.x, p.z).biomeId).toBe(GRASS_BIOME.id);
  });

  it("densityPoints honors slopeRange", () => {
    const b = chunkAt(gx, gz);
    const all = runDressingEnumerator("densityPoints", b, GRASS_DENSITY);
    expect(runDressingEnumerator("densityPoints", b, { ...GRASS_DENSITY, slopeRange: [0, 90] as [number, number] })).toEqual(all);
    const gentle = runDressingEnumerator("densityPoints", b, { ...GRASS_DENSITY, slopeRange: [0, 3] as [number, number] });
    expect(gentle.length).toBeLessThan(all.length);
  });
});
