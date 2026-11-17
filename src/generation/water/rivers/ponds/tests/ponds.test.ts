import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { computeVertexData, initCompute, unwarp } from "../../../..";
import type { DomainConfig } from "../../../../types";
import { RIVER_POND_LENGTH } from "../../constants";
import { finalEdge, riverPiecesNear, stretchesOf, edgeSurfaces } from "../../network";
import { junctionEndKind } from "../../road-layer";
import type { RiverEdge } from "../../types";

/** The PONDS a river holds (generation/water/rivers/ponds/index.ts): every natural end rolls its <Pond riverEnd> chance — a pond end
 *  holds a disc where no road or lake is in its reach (else the widening the road layer sees), a miss ends
 *  ROUND at the river's own width — the river's joints within a pond's radius stand at its level, a pond
 *  is its <Pond>'s water, and every decision is the same whatever the query order. */

const CONFIG = DOMAIN_CONFIGS.overworld;
const H = 12000;
const edgesIn = (x0: number, z0: number, x1: number, z1: number): RiverEdge[] =>
  [...new Map(riverPiecesNear(x0, z0, x1, z1, 0).map((p) => [p.edge.key, p.edge])).values()].sort((a, b) => (a.key < b.key ? -1 : 1));
const snapshot = (edges: RiverEdge[]) => edges.map((e) => `${e.key} ${edgeSurfaces(e).ponds.map((d) => `${d.x.toFixed(6)},${d.z.toFixed(6)},${d.level.toFixed(6)},${d.body}`).join(" ")}`);

describe("river ponds", () => {
  beforeAll(() => initCompute(CONFIG));

  it("hold a disc at every pond end clear of roads and lakes, the widening elsewhere", () => {
    let discs = 0;
    let widened = 0;
    for (const e of edgesIn(-H, -H, H, H)) {
      finalEdge(e);
      for (const end of stretchesOf(e, e.codes!, (j) => junctionEndKind(e, j)).flat()) {
        if (end.kind !== "pond") continue;
        const linear = e.a.width + ((e.b.width - e.a.width) * end.joint) / e.count;
        if (e.ponds!.some((p) => p.joint === end.joint)) {
          discs++;
          // Not widened by its own end (a short stretch's other end may still shape it).
          expect(e.widths![end.joint]).toBeLessThan(linear * 1.05);
        } else {
          widened++;
          expect(e.widths![end.joint]).toBeGreaterThan(linear * 1.2);
        }
      }
    }
    expect(discs).toBeGreaterThan(20);
    expect(discs).toBeGreaterThan(widened);
  });

  it("stand on their end joint, at least its <Pond minRadiusOverRiver> × the river's half-width across, at its water", () => {
    const hw = CONFIG.river.halfWidth;
    for (const e of edgesIn(-H, -H, H, H)) {
      finalEdge(e);
      const s = edgeSurfaces(e);
      const L = e.len / e.count;
      for (const p of e.ponds!) {
        const linear = e.a.width + ((e.b.width - e.a.width) * p.joint) / e.count;
        expect(p.r).toBeGreaterThanOrEqual(p.mount.minRadiusOverRiver * linear * hw - 1e-9);
        expect(Math.hypot(p.x - (e.ax + e.ux * L * p.joint), p.z - (e.az + e.uz * L * p.joint))).toBeCloseTo(0, 6);
        const level = s.capped[p.joint];
        expect(s.ponds.some((d) => d.x === p.x && d.z === p.z && d.level === level)).toBe(true);
      }
    }
  });

  it("are water where they stand: a kind's of its body past the river's end", () => {
    let wet = 0;
    let owned = 0;
    for (const e of edgesIn(-H, -H, H, H)) {
      const pieces = finalEdge(e);
      for (const p of e.ponds!) {
        const d = edgeSurfaces(e).ponds.find((q) => q.x === p.x && q.z === p.z)!;
        const at = unwarp(p.x, p.z);
        const v = computeVertexData(at.x, at.z);
        // (A lake's level reaching over it owns it: one water, the lake's.)
        if (!(v.waterDepth > 0) || CONFIG.waterBodies[v.waterBody]?.kind === "lake") continue;
        wet++;
        // (The river runs in at its own grade: its water blends with the level near the end joint.)
        expect(Math.abs(v.waterHeight - d.level)).toBeLessThan(3);
        // Half its radius on past the river's end, its own water (on the river's line, the river's).
        const out = pieces[p.joint] ? -1 : 1;
        const past = unwarp(p.x + e.ux * out * 0.5 * p.r, p.z + e.uz * out * 0.5 * p.r);
        const w = computeVertexData(past.x, past.z);
        if (!(w.waterDepth > 0) || CONFIG.waterBodies[w.waterBody]?.kind === "lake") continue;
        owned++;
        expect(w.waterBody).toBe(d.body);
      }
    }
    expect(wet).toBeGreaterThan(10);
    expect(owned).toBeGreaterThan(5);
  });

  it("end a river ROUND at its own width where no kind rolls — every natural end, with no <Pond riverEnd> anywhere", () => {
    const noEndPonds: DomainConfig = {
      ...CONFIG,
      waterBodies: CONFIG.waterBodies.map((b) => (b.kind === "pond" ? { ...b, params: { ...(b.params as object), riverEnd: 0 } } : b)),
    };
    initCompute(noEndPonds);
    let round = 0;
    for (const e of edgesIn(-H / 2, -H / 2, H / 2, H / 2)) {
      finalEdge(e);
      expect(e.ponds).toEqual([]);
      const stretches = stretchesOf(e, e.codes!, (j) => junctionEndKind(e, j));
      for (const [low, high] of stretches) {
        for (const [end, other] of [[low, high], [high, low]]) {
          expect(end.kind).not.toBe("pond");
          // Its width is the river's own: no taper, no widening (unless its stretch's other end widens it, or a climb narrows it).
          if (end.kind !== "round" || Math.abs(other.joint - end.joint) * (e.len / e.count) <= RIVER_POND_LENGTH || e.climbs?.length) continue;
          round++;
          expect(e.widths![end.joint]).toBeCloseTo(e.a.width + ((e.b.width - e.a.width) * end.joint) / e.count, 9);
        }
      }
    }
    expect(round).toBeGreaterThan(10);
    initCompute(CONFIG);
  });

  it("are the same whatever was queried first", () => {
    const first = snapshot(edgesIn(-6000, -6000, 6000, 6000));
    initCompute(CONFIG);
    edgesIn(5000, 5000, 9000, 9000).forEach((e) => edgeSurfaces(e));
    const again = edgesIn(-6000, -6000, 6000, 6000);
    for (const e of [...again].reverse()) edgeSurfaces(e);
    expect(snapshot(again)).toEqual(first);
  });
});
