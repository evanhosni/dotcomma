/** Junction gaps (riverNetwork's junctionGorgesAt): a high stretch between two rivers meeting at a
 *  junction is built as a GORGE when its ridge is low (RIVER_GORGE_MAX_RISE), with a surface that never
 *  runs uphill, and left alone when it is not. Plus the city|lake mouth whose river stood 14u under the
 *  lake beside it. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { computeVertexData, initCompute, unwarp, warp } from "../vertexCompute";
import { riverPieceEndSurface } from "./riverSurface";
import { riverEdgePiece, riverPiecesNear } from "./riverNetwork";
import { riverEdgeBlocked } from "./riverPieceRules";
import type { RiverEdge, RiverGorge } from "./types";

const config = OVERWORLD_CONFIG;

beforeAll(() => initCompute(config));

const edgesNear = (x0: number, z0: number, x1: number, z1: number): RiverEdge[] => [...new Map(riverPiecesNear(x0, z0, x1, z1, 0).map((p) => [p.edge.key, p.edge])).values()];
const gorgesOf = (e: RiverEdge): RiverGorge[] => e.gorges;
/** A gorge's surface at its piece ends, from its river end to its junction. */
const gorgeSurfaces = (e: RiverEdge, g: RiverGorge): number[] => {
  const dir = g.to > g.from ? 1 : -1;
  const out: number[] = [];
  for (let k = g.from; k !== g.to + dir; k += dir) {
    const i = dir > 0 ? Math.min(k, e.count - 1) : Math.max(k - 1, 0);
    const p = riverEdgePiece(e, i);
    if (p) out.push(riverPieceEndSurface(p, k === i ? 0 : 1));
  }
  return out;
};
/** The gorges of a window as edge key + piece range, sorted. */
const gorgeKeys = (x0: number, z0: number, x1: number, z1: number): string[] =>
  edgesNear(x0, z0, x1, z1)
    .flatMap((e) => gorgesOf(e).map((g) => `${e.key}:${g.from}-${g.to}`))
    .sort();

describe("river gorges", () => {
  it("build a low junction gap as a gorge: its pieces built, its water never uphill, carved under the ridge", () => {
    const { halfWidth, bank } = config.river;
    let gorges = 0;
    let banks = 0;
    for (const e of edgesNear(-9000, -9000, 9000, 9000)) {
      for (const g of gorgesOf(e)) {
        gorges++;
        const blocked = riverEdgeBlocked(e);
        for (let i = Math.min(g.from, g.to); i < Math.max(g.from, g.to); i++) expect(blocked[i]).toBe(0);
        const s = gorgeSurfaces(e, g);
        const down = s[0] >= s[s.length - 1] ? s : [...s].reverse();
        for (let i = 1; i < down.length; i++) expect(down[i]).toBeLessThanOrEqual(down[i - 1] + 1e-9);
        // Across the gorge at each inner piece end: water in the channel, never above the ground on its banks.
        const dir = g.to > g.from ? 1 : -1;
        const step = e.len / e.count;
        for (let k = g.from + dir; k !== g.to; k += dir) {
          const wx = e.ax + e.ux * k * step;
          const wz = e.az + e.uz * k * step;
          const c = unwarp(wx, wz);
          const center = computeVertexData(c.x, c.z);
          expect(!(center.distanceToRiverCenter < halfWidth * 0.5) || center.waterHeight > center.height).toBe(true);
          for (let d = -(halfWidth + bank) * 1.6; d <= (halfWidth + bank) * 1.6; d += 6) {
            const q = unwarp(wx - e.uz * d, wz + e.ux * d);
            const v = computeVertexData(q.x, q.z);
            if (Number.isNaN(v.waterHeight) || !(v.distanceToRiverCenter > halfWidth)) continue;
            banks++;
            expect(v.waterHeight).toBeLessThanOrEqual(v.height + 1e-6);
          }
        }
      }
    }
    expect(gorges).toBeGreaterThan(3);
    expect(banks).toBeGreaterThan(50);
  });

  it("join the low ridges between two ponds (images 86, 88) and leave the high one (image 87)", () => {
    const near = (x: number, z: number) => {
      const w = warp(x, z);
      expect(edgesNear(w.x - 300, w.z - 300, w.x + 300, w.z + 300).length).toBeGreaterThan(0);
      return gorgeKeys(w.x - 300, w.z - 300, w.x + 300, w.z + 300).length;
    };
    expect(near(-14439, 18755)).toBeGreaterThan(0);
    // Image 88: a desert river cut in two by a 23u rise over dunes the relief rule read as rock.
    expect(near(-5800, 3790)).toBeGreaterThan(0);
    expect(near(-38021, -11251)).toBe(0);
  });

  it("are decided the same whatever order the river windows are built in", () => {
    const area = [-6000, -6000, 6000, 6000] as const;
    initCompute(config);
    const forward = gorgeKeys(...area);
    initCompute(config);
    // Far corners first, so every junction is reached from another window.
    edgesNear(5000, 5000, 9000, 9000);
    edgesNear(-9000, -9000, -5000, -5000);
    const reverse = gorgeKeys(...area);
    expect(forward.length).toBeGreaterThan(0);
    expect(reverse).toEqual(forward);
  });
});

describe("a river mouth beside a crisp city", () => {
  it("meets the lake's level at the city|lake wall: no step in the water drawn", () => {
    let pairs = 0;
    const visible = (x: number, z: number) => {
      const v = computeVertexData(x, z);
      return v.waterHeight > v.height + 0.01 ? v.waterHeight : NaN;
    };
    for (let z = 1250; z <= 1370; z += 2) {
      let prev = NaN;
      for (let x = 3004; x <= 3124; x += 2) {
        const w = visible(x, z);
        const before = prev;
        prev = w;
        if (Number.isNaN(w) || Number.isNaN(before)) continue;
        pairs++;
        expect(Math.abs(w - before)).toBeLessThan(0.5);
      }
    }
    expect(pairs).toBeGreaterThan(500);
  });
});
