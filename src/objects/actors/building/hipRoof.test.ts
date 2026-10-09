import { generateBuildingPlan } from "./generatePlan";
import { edgeLength, edgeNormal, hipRoofRings, offsetRing, Pt2, ringPoints } from "./rings";
import { HOUSE_SPEC } from "./spec";
import { BuildingPlan } from "./types";

/** Signed distance of p inside edge j's line (outward normals, so inside is positive). */
const insideEdge = (pts: Pt2[], j: number, p: Pt2): number => {
  const n = edgeNormal(pts, j);
  return -((p[0] - pts[j][0]) * n[0] + (p[1] - pts[j][1]) * n[1]);
};

const roofOf = (plan: BuildingPlan) => plan.lofts[plan.bodyLoftCount];

describe("hip roof", () => {
  const SEEDS = Array.from({ length: 150 }, (_, i) => `${i * 53 - 4000}_${i * 29 + 7}`);

  it("pitches every face of every house roof at ONE slope (planar faces, any 3–5-sided plan)", () => {
    for (const seed of SEEDS) {
      const roof = roofOf(generateBuildingPlan(seed, HOUSE_SPEC.hull!));
      const rings = roof.points!;
      const eave = rings[1];
      const fasciaY = roof.levels[2].y;
      let slope: number | null = null;
      for (let k = 3; k < rings.length; k++) {
        for (let j = 0; j < eave.length; j++) {
          // A face that closed at an earlier event has no trail left (its points move on with its neighbors').
          if (edgeLength(rings[k - 1], j) < 1e-6) continue;
          // Both endpoints of edge j's trail lie on face j: rise ÷ inset from edge j is the pitch.
          for (const p of [rings[k][j], rings[k][(j + 1) % eave.length]]) {
            const s = (roof.levels[k].y - fasciaY) / insideEdge(eave, j, p);
            slope ??= s;
            expect(s).toBeCloseTo(slope, 6);
          }
        }
      }
      expect(slope).toBeGreaterThan(Math.tan(0.5));
    }
  });

  it("overhangs every wall by the same distance", () => {
    for (const seed of SEEDS) {
      const roof = roofOf(generateBuildingPlan(seed, HOUSE_SPEC.hull!));
      const [wall, eave] = roof.points!;
      const d = -insideEdge(wall, 0, eave[0]);
      for (let j = 0; j < wall.length; j++) {
        expect(-insideEdge(wall, j, eave[j])).toBeCloseTo(d, 6);
        expect(-insideEdge(wall, j, eave[(j + 1) % wall.length])).toBeCloseTo(d, 6);
      }
    }
  });

  it("peaks a triangle at its incenter and ridges a rectangle along its long axis", () => {
    const tri: Pt2[] = [
      [0, 10],
      [12, -4],
      [-5, -6],
    ];
    const { rings, offsets } = hipRoofRings(tri);
    const apex = rings[rings.length - 1];
    for (const p of apex) {
      for (let j = 0; j < 3; j++) expect(insideEdge(tri, j, p)).toBeCloseTo(offsets[offsets.length - 1], 6);
    }

    const rect = ringPoints(true, 4, { y: 0, cx: 0, cz: 0, halfWidth: 9, halfDepth: 5 });
    const ridge = hipRoofRings(rect);
    expect(ridge.offsets[ridge.offsets.length - 1]).toBeCloseTo(5, 6);
    const top = ridge.rings[ridge.rings.length - 1];
    const xs = top.map((p) => p[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8, 6);
    for (const p of top) expect(p[1]).toBeCloseTo(0, 6);
  });

  it("offsetRing moves every edge by exactly d", () => {
    const pts = ringPoints(false, 5, { y: 0, cx: 0, cz: 0, halfWidth: 8, halfDepth: 13 }, 0.7);
    const inner = offsetRing(pts, 1.5);
    for (let j = 0; j < pts.length; j++) {
      expect(insideEdge(pts, j, inner[j])).toBeCloseTo(1.5, 9);
      expect(edgeLength(inner, j)).toBeLessThan(edgeLength(pts, j));
    }
  });
});
