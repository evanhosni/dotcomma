/**
 * Smoke tests for the city feature enumerators (traffic lights / freeway-side
 * points): determinism, duplicate-freedom across chunk splits, and placement
 * validity against the shared vertex pipeline. Runs the REAL compute module
 * with a config mirroring the live GameWorld registrations.
 */
import { DEFAULT_WORLD_TERRAIN_PARAMS } from "../world/registry";
import {
  computeVertexData,
  getCityFreewaySidePoints,
  getCityTrafficLightPoints,
  initCompute,
  WorldConfig,
} from "./vertexCompute";

const P = DEFAULT_WORLD_TERRAIN_PARAMS;
const config: WorldConfig = {
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
};

const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)}|${p.z.toFixed(3)}`;

/** Center of a reasonably deep city area (found by coarse scan). */
let cx = 0;
let cz = 0;

beforeAll(() => {
  initCompute(config);
  let best = -Infinity;
  for (let x = -6000; x <= 6000; x += 200) {
    for (let z = -6000; z <= 6000; z += 200) {
      const vd = computeVertexData(x, z);
      if (vd.biomeId === 1 && vd.distanceToBiomeBoundaryCenter > best) {
        best = vd.distanceToBiomeBoundaryCenter;
        cx = x;
        cz = z;
      }
    }
  }
  expect(best).toBeGreaterThan(100); // found a city interior to test in
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
