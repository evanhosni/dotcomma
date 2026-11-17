import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import type { DomainConfig } from "../../../../types";
import { initCompute, warp } from "../../../..";
import { getWaterfallBoulders } from "../../../parts/waterfall-boulders";
import { PIECE_CLIMB, pieceBuilt } from "../../enums";
import { finalEdge, riverPiecesRaw, baseJointSurface, edgeSurfaces } from "../../network";
import { gorgedCodes } from "../../gaps";
import { climbedCodes } from "..";
import type { RiverEdge } from "../../types";

/** SUMMIT connections (generation/water/rivers/ponds/index.ts): the gaps the gorges left between two waters, climbed to a pond on top
 *  where a <Pond summit> rolls — image 7's among them; the pond on the gap's flattest joint near its top;
 *  the water never rising away from it; nothing shorter than its rules' shortGap climbed; the same whatever was
 *  queried first; falls dressed like any; and nothing climbed where no <Pond summit> is mounted. */

const CONFIG = DOMAIN_CONFIGS.overworld;
/** The overworld with every <Pond>'s summit chance at 0. */
const WITHOUT_SUMMITS: DomainConfig = {
  ...CONFIG,
  waterBodies: CONFIG.waterBodies.map((b) => (b.kind === "pond" ? { ...b, params: { ...(b.params as object), summit: 0 } } : b)),
};
const H = 14000;
const edgesIn = (x0: number, z0: number, x1: number, z1: number): RiverEdge[] =>
  [...new Map(riverPiecesRaw(x0, z0, x1, z1, 0).map((p) => [p.edge.key, p.edge])).values()].sort((a, b) =>
    a.key < b.key ? -1 : 1,
  );
const snapshot = (edges: RiverEdge[]) =>
  edges.map((e) => `${e.key} ${Array.from(climbedCodes(e)).join("")} ${(e.climbs ?? []).map((c) => `${c.k0}-${c.k1}@${c.summit.pond.x.toFixed(6)},${c.summit.pond.level.toFixed(6)}`).join(" ")}`);

describe("summit connections", () => {
  let edges: RiverEdge[] = [];
  beforeAll(() => {
    initCompute(CONFIG);
    edges = edgesIn(-H, -H, H, H);
  });

  it("climb image 7's gap to a pond on top", () => {
    const w = warp(11635.9, -8824.7);
    const e = edgesIn(w.x - 800, w.z - 800, w.x + 800, w.z + 800).find((f) => f.key === "3,-3~3,-4")!;
    const codes = climbedCodes(e);
    expect(e.climbs!.length).toBe(1);
    const { k0, k1, summit } = e.climbs![0];
    for (let i = k0; i < k1; i++) {
      expect(codes[i]).toBe(PIECE_CLIMB);
      expect(finalEdge(e)[i]).not.toBeNull();
    }
    expect(edgeSurfaces(e).ponds.some((d) => d.x === summit.pond.x && d.level === summit.pond.level)).toBe(true);
  });

  it("stand the pond on a joint near the top, its water falling away to both waters", () => {
    let climbs = 0;
    for (const e of edges) {
      climbedCodes(e);
      const s = edgeSurfaces(e);
      for (const { k0, k1, summit } of e.climbs ?? []) {
        climbs++;
        if (summit.edge === e) {
          let top = -Infinity;
          for (let k = k0; k <= k1; k++) top = Math.max(top, baseJointSurface(e, k));
          // Under the lowest ground round its radius at most, but no deeper under the top than a fall may cut.
          expect(summit.pond.level).toBeGreaterThanOrEqual(top - e.rules.maxCarve - 1e-9);
          const kc = summit.pond.joint;
          for (let k = kc; k < k1; k++) expect(s.capped[k + 1]).toBeLessThanOrEqual(s.capped[k] + 1e-9);
          for (let k = kc; k > k0; k--) expect(s.capped[k - 1]).toBeLessThanOrEqual(s.capped[k] + 1e-9);
        } else {
          // Reached through a junction: falling from the junction's water toward its own.
          const atA = summit.junction!.key === e.a.key;
          for (let k = k0; k < k1; k++) expect(atA ? s.capped[k + 1] - s.capped[k] : s.capped[k] - s.capped[k + 1]).toBeLessThanOrEqual(1e-9);
        }
      }
    }
    expect(climbs).toBeGreaterThan(5);
  });

  it("climb only gaps the gorges left, never one shorter than its rules' shortGap", () => {
    for (const e of edges) {
      const gorged = gorgedCodes(e);
      const codes = climbedCodes(e);
      for (let i = 0; i < e.count; i++) if (codes[i] === PIECE_CLIMB) expect(pieceBuilt(gorged[i])).toBe(false);
      for (const c of e.climbs ?? []) if (!c.summit.junction) expect(((c.k1 - c.k0) * e.len) / e.count).toBeGreaterThanOrEqual(e.rules.shortGap);
    }
  });

  it("are decided the same whatever was queried first", () => {
    const first = snapshot(edgesIn(-8000, -12000, 14000, 0));
    initCompute(CONFIG);
    edgesIn(10000, -6000, 16000, 2000).forEach((e) => finalEdge(e));
    const again = edgesIn(-8000, -12000, 14000, 0);
    for (const e of [...again].reverse()) edgeSurfaces(e);
    expect(snapshot(again)).toEqual(first);
  });

  it("dress their falls with boulders like any steep river", () => {
    const w = warp(11635.9, -8824.7);
    const boulders = () => getWaterfallBoulders(w.x - 800, w.z - 400, w.x + 800, w.z + 400).length;
    initCompute(WITHOUT_SUMMITS);
    const without = boulders();
    initCompute(CONFIG);
    expect(boulders()).toBeGreaterThan(without);
  });

  it("climb nothing where no <Pond summit> is mounted", () => {
    initCompute(WITHOUT_SUMMITS);
    for (const e of edgesIn(-H, -H, H, H)) expect(climbedCodes(e)).toBe(gorgedCodes(e));
    initCompute(CONFIG);
  });
});
