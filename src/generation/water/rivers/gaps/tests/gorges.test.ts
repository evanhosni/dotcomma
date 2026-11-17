import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { computeVertexData, computeVertexDataFar, initCompute, unwarp, warp } from "../../../..";
import { PIECE_GORGE, PIECE_MOUNTAIN, PIECE_WATER, pieceBuilt } from "../../enums";
import { finalEdge, jointAt, junctionEdges, riverPiecesNear, edgeSurfaces } from "../../network";
import { gorgedCodes, ownCodes } from "..";
import type { RiverEdge } from "../../types";

/** Gorges and the surfaces they carry (generation/water/rivers/gaps/index.ts, generation/water/rivers/network/index.ts): decided the same whatever was
 *  queried first, their water straight and never uphill, one water where they meet at a junction, low
 *  ridges and short gaps cut (with walls that slope back) and mountains never climbed, and a river's water held up beside a crisp city at a lake. */

const CONFIG = DOMAIN_CONFIGS.overworld;

const edgesIn = (x0: number, z0: number, x1: number, z1: number): RiverEdge[] => {
  const edges = new Map<string, RiverEdge>();
  for (const p of riverPiecesNear(x0, z0, x1, z1, 0)) edges.set(p.edge.key, p.edge);
  return [...edges.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
};
const snapshot = (edges: RiverEdge[]): string[] => edges.map((e) => `${e.key} ${Array.from(finalEdge(e).map((p) => (p ? 1 : 0))).join("")} ${Array.from(edgeSurfaces(e).capped, (v) => v.toFixed(6)).join(",")}`);

describe("gorges", () => {
  it("are decided the same whatever was queried first", () => {
    initCompute(CONFIG);
    const first = snapshot(edgesIn(-5000, -5000, 5000, 5000));
    initCompute(CONFIG);
    // A different first query (the far corner, then the edges in reverse), so every cache fills in another order.
    edgesIn(4000, 4000, 9000, 9000).forEach((e) => finalEdge(e));
    const keys = first.map((s) => s.split(" ")[0]);
    const again = edgesIn(-5000, -5000, 5000, 5000);
    for (const e of [...again].reverse()) edgeSurfaces(e);
    expect(snapshot(again)).toEqual(first);
    expect(keys.length).toBeGreaterThan(20);
  });

  it("run their water straight between the waters they join, never uphill", () => {
    initCompute(CONFIG);
    let gorges = 0;
    for (const e of edgesIn(-12000, -12000, 12000, 12000)) {
      gorgedCodes(e);
      const s = edgeSurfaces(e);
      for (const g of e.gorges ?? []) {
        if (!finalEdge(e).slice(g.k0, g.k1).every((p) => p)) continue;
        gorges++;
        const c0 = s.capped[g.k0];
        const c1 = s.capped[g.k1];
        const down = c0 >= c1 ? 1 : -1;
        for (let k = g.k0; k < g.k1; k++) {
          expect((s.capped[k] - s.capped[k + 1]) * down).toBeGreaterThanOrEqual(-1e-9);
          expect(s.capped[k]).toBeLessThanOrEqual(c0 + ((c1 - c0) * (k - g.k0)) / (g.k1 - g.k0) + 1e-6);
        }
      }
    }
    expect(gorges).toBeGreaterThan(0);
  });

  it("meet at one water where several end at a junction", () => {
    initCompute(CONFIG);
    let met = 0;
    for (const e of edgesIn(-12000, -12000, 12000, 12000)) {
      for (const j of [e.a, e.b]) {
        const built = junctionEdges(j).filter((f) => finalEdge(f)[j.key === f.a.key ? 0 : f.count - 1]);
        if (built.length < 2 || !built.some((f) => gorgedCodes(f)[j.key === f.a.key ? 0 : f.count - 1] === PIECE_GORGE)) continue;
        met++;
        const values = built.map((f) => edgeSurfaces(f).capped[jointAt(f, j)]);
        for (const v of values) expect(v).toBeCloseTo(values[0], 6);
      }
    }
    expect(met).toBeGreaterThan(0);
  });

  it("join two waters across a short gap whatever its rise, with walls that slope back", () => {
    initCompute(CONFIG);
    // Nov 2026, Evan's screenshots: two ponds facing each other across a 51u, a 119u and a 90u ridge.
    for (const [x, z] of [
      [9912, -10740],
      [9870, -9864],
      [12816, -9132],
    ]) {
      const w = warp(x, z);
      const gorges = edgesIn(w.x - 400, w.z - 400, w.x + 400, w.z + 400).flatMap((e) => (gorgedCodes(e), (e.gorges ?? []).map((g) => ({ e, g }))));
      const built = gorges.filter(({ e, g }) => finalEdge(e).slice(g.k0, g.k1).every((p) => p));
      expect(built.length).toBeGreaterThan(0);
      for (const { e, g } of built) {
        // Across the middle of the gorge the ground never stands as a cliff: the bank alone cut 80° walls
        // (a 10u step of 6.3 at the 119u ridge); the wall's 1.25 grade, wound by the meander, reaches 1.84.
        const L = e.len / e.count;
        const s = ((g.k0 + g.k1) / 2) * L;
        let prev = NaN;
        for (let d = -200; d <= 200; d += 10) {
          const p = unwarp(e.ax + e.ux * s - e.uz * d, e.az + e.uz * s + e.ux * d);
          const h = computeVertexData(p.x, p.z).height;
          if (!Number.isNaN(prev)) expect(Math.abs(h - prev) / 10).toBeLessThan(2);
          prev = h;
        }
      }
    }
  });

  it("cut the channel at the river's own depth through the ridge", () => {
    initCompute(CONFIG);
    let cut = 0;
    for (const e of edgesIn(-12000, -12000, 12000, 12000)) {
      const codes = gorgedCodes(e);
      const pieces = finalEdge(e);
      for (let i = 0; i < e.count && cut < 40; i++) {
        const p = pieces[i];
        if (codes[i] !== PIECE_GORGE || !p) continue;
        const at = unwarp((p.sx + p.ex) / 2, (p.sz + p.ez) / 2);
        const v = computeVertexData(at.x, at.z);
        if (v.underDeck > 0 || !Number.isNaN(computeVertexDataFar(at.x, at.z, false).waterHeight)) continue;
        cut++;
        expect(v.waterHeight).toBeGreaterThan(v.height);
      }
    }
    expect(cut).toBeGreaterThan(0);
  });
});

describe("a river mouth beside a crisp city", () => {
  beforeAll(() => initCompute(CONFIG));

  it("join the low ridges between two ponds (images 86, 88) and leave the high one (image 87)", () => {
    const gorgesNear = (x: number, z: number): number => {
      const w = warp(x, z);
      const edges = edgesIn(w.x - 300, w.z - 300, w.x + 300, w.z + 300);
      expect(edges.length).toBeGreaterThan(0);
      return edges.reduce((n, e) => (gorgedCodes(e), n + (e.gorges?.length ?? 0)), 0);
    };
    expect(gorgesNear(-14439, 18755)).toBeGreaterThan(0);
    // Image 88: a desert river cut in two by a 23u rise over dunes the relief rule read as rock.
    expect(gorgesNear(-5800, 3790)).toBeGreaterThan(0);
    // Image 87: a river never climbs a mountain. No piece on mountain relief is built but as a gorge;
    // where none is cut the river ends at the foot.
    const w = warp(-38021, -11251);
    let carvedOrEnded = 0;
    for (const e of edgesIn(w.x - 2000, w.z - 2000, w.x + 2000, w.z + 2000)) {
      const own = ownCodes(e);
      const codes = gorgedCodes(e);
      for (let i = 0; i < e.count; i++) if (own[i] === PIECE_MOUNTAIN) expect(codes[i] === PIECE_GORGE || !pieceBuilt(codes[i])).toBe(true);
      carvedOrEnded += e.gorges?.length ?? 0;
      // A built piece whose unbuilt neighbours run on into a mountain: the river ended at its foot.
      const hitsMountain = (first: number, dir: 1 | -1): boolean => {
        for (let i = first; i >= 0 && i < e.count && !pieceBuilt(codes[i]) && codes[i] !== PIECE_WATER; i += dir) if (codes[i] === PIECE_MOUNTAIN) return true;
        return false;
      };
      for (let k = 1; k < e.count; k++) if ((pieceBuilt(codes[k - 1]) && hitsMountain(k, 1)) || (pieceBuilt(codes[k]) && hitsMountain(k - 1, -1))) carvedOrEnded++;
    }
    expect(carvedOrEnded).toBeGreaterThan(0);
  });

  it("holds the river's water up to the lake's level beside the city (3064, 1310)", () => {
    for (let dx = -40; dx <= 40; dx += 8) {
      for (let dz = -40; dz <= 40; dz += 8) {
        const v = computeVertexData(3064 + dx, 1310 + dz);
        const lake = computeVertexDataFar(3064 + dx, 1310 + dz, false).waterHeight;
        if (Number.isNaN(v.waterHeight) || Number.isNaN(lake)) continue;
        expect(v.waterHeight).toBeGreaterThan(lake - 1);
      }
    }
  });
});
