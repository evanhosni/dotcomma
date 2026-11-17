/** River JOINS (generation/water/rivers/network/index.ts edgeOf): a grid edge its roll dropped is kept where it joins a river end to
 *  another river across a gap the gorge rule cuts — Evan's river end 311u from the river at (-4836, -16743)
 *  among them — decided the same whatever is queried first, and never by another revived edge. */
import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { initCompute } from "../../../..";
import { finalEdge, junctionEdges, riverPiecesNear } from "..";
import type { RiverEdge } from "../../types";

const CONFIG = DOMAIN_CONFIGS.overworld;

const edgesIn = (x0: number, z0: number, x1: number, z1: number): Map<string, RiverEdge> =>
  new Map(riverPiecesNear(x0, z0, x1, z1, 0).map((p) => [p.edge.key, p.edge]));
const revivedIn = (edges: Map<string, RiverEdge>): string[] => [...edges.values()].filter((e) => e.revived).map((e) => e.key).sort();

describe("river joins", () => {
  beforeAll(() => initCompute(CONFIG));

  it("join Evan's river end to the river beside it, which goes on there at its full width", () => {
    const edges = edgesIn(-5500, -17500, -4000, -16000);
    const join = edges.get("-2,-6~-3,-7")!;
    expect(join?.revived).toBe(true);
    expect(finalEdge(join).every((p) => p !== null)).toBe(true);
    const joined = edges.get("-2,-6~-3,-6")!;
    const widths = finalEdge(joined) && joined.widths!;
    // Was 0.21 at its end (it fizzled out, before the join); now the joint is shared with the join.
    expect(widths[widths.length - 1]).toBeGreaterThan(1);
  });

  it("only revive gaps the gorge rule could cut, each with a river end on one side and a river on the other", () => {
    const edges = edgesIn(-10000, -10000, 10000, 10000);
    const revived = [...edges.values()].filter((e) => e.revived);
    expect(revived.length).toBeGreaterThan(2);
    for (const e of revived) {
      expect(e.len).toBeLessThanOrEqual(e.rules.gapFill);
      const rolled = (j: RiverEdge["a"]) => junctionEdges(j).filter((f) => f.key !== e.key && !f.revived).length;
      expect(Math.min(rolled(e.a), rolled(e.b))).toBe(1);
      expect(Math.max(rolled(e.a), rolled(e.b))).toBeLessThanOrEqual(2);
    }
  });

  it("are decided the same whatever was queried first", () => {
    initCompute(CONFIG);
    const first = revivedIn(edgesIn(-10000, -10000, 10000, 10000));
    initCompute(CONFIG);
    edgesIn(6000, 6000, 14000, 14000);
    edgesIn(-14000, -14000, -6000, -6000);
    expect(revivedIn(edgesIn(-10000, -10000, 10000, 10000))).toEqual(first);
  }, 300000);
});
