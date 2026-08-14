/**
 * Smoke tests for the city feature enumerators (traffic lights / freeway-side
 * points): determinism, duplicate-freedom across chunk splits, and placement
 * validity against the shared vertex pipeline. Runs the REAL compute module
 * with a config mirroring the live GlitchCityDomain registrations.
 */
import { DEFAULT_TERRAIN_PARAMS } from "../../world/defaults";
import {
  computeVertexData,
  computeVertexDataRaw,
  getCityFreewaySidePoints,
  getCityRoadMarkers,
  getCityTrafficLightPoints,
  getFlattenPoints,
  initCompute,
  DomainConfig,
} from "./vertexCompute";

const P = DEFAULT_TERRAIN_PARAMS;
const config: DomainConfig = {
  seed: "123",
  regions: [
    {
      id: 3,
      name: "city",
      biomes: [
        { id: 1, name: "city", joinable: true, blendable: false, blendWidth: 3 },
        { id: 3, name: "grass", joinable: true, blendable: true },
      ],
    },
    {
      id: 2,
      name: "desert",
      biomes: [{ id: 2, name: "dust", joinable: true, blendable: true }],
    },
  ],
  gridSize: P.gridSize,
  regionGridSize: P.regionGridSize,
  boundaryWidth: P.boundaryWidth,
  riverWidth: P.riverWidth,
  defaultBlendWidth: P.defaultBlendWidth,
  roadNoiseParams: P.roadNoise,
  baseNoiseParams: P.baseNoise,
  biomeNoiseConfigs: {},
  cityConfig: P.cityConfig,
  // Mirrors BuildingDescriptor's placement rules (flattenGround: true) plus
  // the grass-biome country building.
  flattenDescriptors: [
    {
      id: "building",
      density: 3800,
      clustering: 0,
      footprint: 30,
      priority: 55,
      biomeIds: [1],
      roadDistanceRange: [23, 99999],
      radius: 13.5,
      skirt: 10.5,
    },
    {
      id: "grass-building",
      density: 25,
      clustering: 0,
      footprint: 30,
      priority: 55,
      biomeIds: [3],
      roadDistanceRange: [23, 99999],
      radius: 13.5,
      skirt: 10.5,
    },
  ],
};

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;

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
      if (vd.biomeId === 1 && vd.distanceToBiomeBoundaryCenter > best) {
        best = vd.distanceToBiomeBoundaryCenter;
        cx = x;
        cz = z;
      }
      if (vd.biomeId === 3 && vd.distanceToBiomeBoundaryCenter > bestGrass) {
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
      expect(vd.biomeId).toBe(1);
      expect(vd.height).toBeCloseTo(p.y, 5);
      // Sidewalk band of the road field (poles never stand on asphalt).
      expect(vd.distanceToRoadCenter).toBeGreaterThanOrEqual(8.4);
      expect(vd.distanceToRoadCenter).toBeLessThanOrEqual(11.6);
      // Facing direction is unit-length.
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

  it("pads work in ANY biome — grass-biome buildings level the rolling terrain", () => {
    const points = getFlattenPoints(gx - 500, gz - 500, gx + 500, gz + 500).filter(
      (p) => p.descId === "grass-building"
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
    // Spacing: no two points within the descriptor footprint.
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
    const beltR = P.boundaryWidth + P.cityConfig.freewayWidth;
    const points = getCityRoadMarkers(cx - R, cz - R, cx + R, cz + R, 9, 11);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      const d = computeVertexData(p.x, p.z).distanceToBiomeBoundaryCenter;
      // Belt MEDIAN markers sit on the belt centerline (≈ beltR); everything
      // else must be strictly inside the ring. Nothing may sit in the strip
      // beyond the belt (d < beltR − 3).
      expect(d).toBeGreaterThan(beltR - 3);
    }
  });
});

describe("getCityFreewaySidePoints", () => {
  const R = 760; // > half a district pitch — guarantees arterials in range
  const SPACING = 6;
  const LATERAL = P.cityConfig.freewayWidth + 1.3;
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
    const beltR = P.boundaryWidth + P.cityConfig.freewayWidth;
    const vdOf = (p: { x: number; z: number }) => computeVertexData(p.x, p.z);
    const isArterial = (p: { x: number; z: number }) =>
      Math.abs(vdOf(p).distanceToBiomeBoundaryCenter - beltR) > 20;
    expect(parts.filter(isArterial).map(key).sort()).toEqual(
      whole.filter(isArterial).map(key).sort()
    );

    const fwScale = P.cityConfig.roadWidth / P.cityConfig.freewayWidth;
    for (const p of whole) {
      const vd = vdOf(p);
      expect(vd.biomeId).toBe(1);
      expect(vd.height).toBeCloseTo(p.y, 5);
      expect(vd.distanceToRoadCenter).toBeGreaterThanOrEqual(LATERAL * fwScale - 1.5);
      expect(Math.hypot(p.dirX, p.dirZ)).toBeCloseTo(1, 5);
      expect(Math.abs(p.side)).toBe(1);
    }
  });

  it("links each point to its emitted successor (wire spans survive chunk borders)", () => {
    const POLE_SPACING = 55;
    const whole = getCityFreewaySidePoints(
      cx - R, cz - R, cx + R, cz + R, POLE_SPACING, P.cityConfig.freewayWidth + 5, 26, true
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
