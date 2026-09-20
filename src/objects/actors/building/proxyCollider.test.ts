import { generateBuildingPlan } from "./generatePlan";
import { buildProxyHullVertices } from "./proxyCollider";
import { ringPoints } from "./rings";
import { BuildingPlan } from "./types";

describe("building proxy collider hull", () => {
  const SEEDS = ["0_0", "1240_-880", "-5_617", "99999_99999"];

  const extents = (v: Float32Array) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < v.length; i += 3) {
      minX = Math.min(minX, v[i]); maxX = Math.max(maxX, v[i]);
      minY = Math.min(minY, v[i + 1]); maxY = Math.max(maxY, v[i + 1]);
      minZ = Math.min(minZ, v[i + 2]); maxZ = Math.max(maxZ, v[i + 2]);
    }
    return { minX, maxX, minY, maxY, minZ, maxZ };
  };

  it("is deterministic per seed", () => {
    for (const seed of SEEDS) {
      const a = buildProxyHullVertices(generateBuildingPlan(seed, {}));
      const b = buildProxyHullVertices(generateBuildingPlan(seed, {}));
      expect(Array.from(a)).toEqual(Array.from(b));
    }
  });

  /** A degenerate cloud makes Rapier return null, and that building would be passable. */
  it("produces a non-degenerate point cloud", () => {
    for (const seed of SEEDS) {
      const v = buildProxyHullVertices(generateBuildingPlan(seed, {}));
      expect(v.length % 3).toBe(0);
      expect(v.length / 3).toBeGreaterThanOrEqual(8); // at least two rings
      expect(v.every(Number.isFinite)).toBe(true);
      const e = extents(v);
      expect(e.maxX - e.minX).toBeGreaterThan(0);
      expect(e.maxZ - e.minZ).toBeGreaterThan(0);
      expect(e.maxY - e.minY).toBeGreaterThan(0);
    }
  });

  /** Rapier QuickHulls this cloud on every proxy mount; every ring corner was ~83 points (worst 133). */
  it("stays a minimal silhouette prism", () => {
    for (const seed of SEEDS) {
      const plan = generateBuildingPlan(seed, {});
      const v = buildProxyHullVertices(plan);
      const count = v.length / 3;
      expect(count).toBeLessThanOrEqual(40);
      // Two identical rings — the silhouette at the bottom and at the top.
      expect(count % 2).toBe(0);
      const half = count / 2;
      const shadow = hull2D(v);
      expect(shadow.length).toBe(half); // every point is ON the hull
      for (let i = 0; i < half; i++) {
        expect(v[i * 3]).toBeCloseTo(v[(half + i) * 3], 6); // same x
        expect(v[i * 3 + 2]).toBeCloseTo(v[(half + i) * 3 + 2], 6); // same z
      }
    }
  });

  it("is never narrower than the real shell at any walkable height", () => {
    for (const seed of SEEDS) {
      const plan = generateBuildingPlan(seed, {});
      const hull = buildProxyHullVertices(plan);
      const shadow = hull2D(hull);
      const e = extents(hull);

      expect(e.minY).toBeLessThanOrEqual(-plan.foundationDepth + 1e-3);
      expect(e.maxY).toBeGreaterThanOrEqual(plan.doorBandTop);

      // Walls interpolate between ring corners, so a hull containing every
      // corner in its height band (roof lofts included) contains the shell.
      let checked = 0;
      for (const { x, y, z } of allRingCorners(plan)) {
        if (y < e.minY || y > e.maxY) continue;
        checked++;
        expect(insideHull2D(shadow, x, z, 1e-3)).toBe(true);
      }
      expect(checked).toBeGreaterThan(16);
    }
  });
});

const allRingCorners = (plan: BuildingPlan): Array<{ x: number; y: number; z: number }> => {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const loft of plan.lofts) {
    for (const level of loft.levels) {
      for (const [x, z] of ringPoints(loft.rect, loft.sides, level, loft.ringRotation)) {
        out.push({ x, y: level.y, z });
      }
    }
  }
  return out;
};

// Test-only: states the covering property independently of Rapier.
const hull2D = (xyz: Float32Array): number[][] => {
  const pts: number[][] = [];
  for (let i = 0; i < xyz.length; i += 3) pts.push([xyz[i], xyz[i + 2]]);
  pts.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (input: number[][]): number[][] => {
    const out: number[][] = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return half(pts).concat(half(pts.slice().reverse())); // CCW
};

const insideHull2D = (poly: number[][], x: number, z: number, pad: number): boolean => {
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ez = bz - az;
    if (ex * (z - az) - ez * (x - ax) < -pad * Math.hypot(ex, ez)) return false;
  }
  return true;
};
