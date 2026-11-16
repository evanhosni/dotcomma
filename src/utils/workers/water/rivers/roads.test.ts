/** The road wins (rivers/roadLayer.ts): no river runs on under a run or arterial following it for long,
 *  no river end lies under a run, a crossing freeway holds the water under it, and a world without
 *  <Rivers> has no river at all. Where roads meet rivers: nothing stands on a deck, a freeway reaching a
 *  city river is decked or ends short of it, and no tiny piece of road is left where a river cut it. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { BRIDGE_PLACEMENT } from "../../../../objects/dressing/bridges/spec";
import { LAMP_PLACEMENT } from "../../../../objects/dressing/street-lamps/spec";
import { distanceToSegment } from "../../../math";
import { BRIDGE_CUT_FEATHER } from "../../bridges/constants";
import { generateDensityPoints } from "../../densityPoints";
import { type FreewayBridge, computeVertexData, getFreewayBridges, getFreewayMouths, initCompute, warp } from "../../vertexCompute";
import { RIVER_ROAD_ALIGN, RIVER_ROAD_ALONG_MIN, riverKeepOff } from "./constants";
import { riverFieldAt, riverSample } from "./field";
import { finalEdge, riverPieceEnds, riverPiecesNear, riversEnabled } from "./network";
import { riverEdgeNearRoads } from "./roadLayer";
import type { RiverEdge, RiverPiece } from "./types";

const CONFIG = DOMAIN_CONFIGS.overworld;

/** The river edges near roads with a built piece within a warped square. */
const roadEdges = (r: number): RiverEdge[] => {
  const edges = new Map<string, RiverEdge>();
  for (const p of riverPiecesNear(-r, -r, r, r, 0)) if (riverEdgeNearRoads(p.edge)) edges.set(p.edge.key, p.edge);
  return [...edges.values()];
};

describe("the road layer", () => {
  beforeAll(() => initCompute(CONFIG));

  it("leaves no river under a run or arterial following it inside its footprint for RIVER_ROAD_ALONG_MIN", () => {
    const fw = CONFIG.cityConfig.freewayWidth;
    const cos = Math.cos(RIVER_ROAD_ALIGN);
    let roads = 0;
    for (const e of roadEdges(6000)) {
      const pieces = finalEdge(e).filter((p): p is RiverPiece => p !== null);
      for (const path of e.roads ?? []) {
        if (path.kind === "belt") continue;
        roads++;
        let run = 0;
        for (let i = 1; i < path.wx.length; i++) {
          const dx = path.wx[i] - path.wx[i - 1];
          const dz = path.wz[i] - path.wz[i - 1];
          const inside = pieces.some((p) => distanceToSegment(path.wx[i], path.wz[i], p.sx, p.sz, p.ex, p.ez) - fw < riverKeepOff() * Math.min(p.w0, p.w1));
          run = inside && Math.abs(dx * e.ux + dz * e.uz) > cos * Math.hypot(dx, dz) ? run + Math.hypot(path.x[i] - path.x[i - 1], path.z[i] - path.z[i - 1]) : 0;
          expect(run).toBeLessThan(RIVER_ROAD_ALONG_MIN + 20);
        }
      }
    }
    expect(roads).toBeGreaterThan(0);
  });

  it("retracts every river end from under a run", () => {
    let ends = 0;
    for (const e of roadEdges(6000)) {
      const runs = (e.roads ?? []).filter((p) => p.kind === "run");
      for (const p of finalEdge(e)) {
        if (!p) continue;
        const [a, b] = riverPieceEnds(p);
        if (!a && !b) continue;
        ends++;
        // The river's own width (its end shape left out) at the piece.
        const w = e.a.width + ((e.b.width - e.a.width) * (p.index + 0.5)) / e.count;
        for (const run of runs) for (let i = 0; i < run.wx.length; i++) expect(distanceToSegment(run.wx[i], run.wz[i], p.sx, p.sz, p.ex, p.ez)).toBeGreaterThanOrEqual(riverKeepOff() * w * 0.97);
      }
    }
    expect(ends).toBeGreaterThan(0);
  });

  it("holds the water under a run crossing it below the run's ground on either bank", () => {
    let crossings = 0;
    for (const e of roadEdges(8000)) {
      for (const path of e.roads ?? []) {
        if (path.kind !== "run") continue;
        const n = path.wx.length;
        const distance = (i: number): number => {
          riverFieldAt(path.wx[i], path.wz[i], false, false);
          return riverSample.distance;
        };
        for (let i = 1; i < n; i++) {
          if (!(distance(i) < 10 && distance(i - 1) >= 10)) continue;
          // The road's ground where it leaves the footprint on either side.
          let lo = i;
          while (lo > 0 && distance(lo) < riverKeepOff()) lo--;
          let hi = i;
          while (hi < n - 1 && distance(hi) < riverKeepOff()) hi++;
          if (distance(lo) < riverKeepOff() || distance(hi) < riverKeepOff()) continue;
          const ground = Math.min(computeVertexData(path.x[lo], path.z[lo]).approachHeight, computeVertexData(path.x[hi], path.z[hi]).approachHeight);
          riverFieldAt(path.wx[i], path.wz[i], false, false);
          crossings++;
          expect(riverSample.surface).toBeLessThan(ground + 1);
        }
      }
    }
    expect(crossings).toBeGreaterThan(0);
  });
});

const CHUNK = 256;

/** Every deck owned by a chunk within r chunks of (cx, cz). */
const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out: FreewayBridge[] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

/** Distance from a point to a deck's centerline, beside it (past its ends: Infinity). */
const besideDeck = (b: FreewayBridge, x: number, z: number): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < b.path.length; i++) {
    const a = b.path[i];
    const c = b.path[i + 1];
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
    if (t < 0 || t > 1) continue;
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
};

/** A city river with arterials on both banks: its mouths pair across it. */
const AREA = { x: -4400, z: 700, r: 3 };

describe("roads at rivers", () => {
  let decks: FreewayBridge[] = [];
  beforeAll(() => {
    initCompute(CONFIG);
    decks = decksNear(AREA.x, AREA.z, AREA.r);
  });

  it("places no street lamp on or beside a deck", () => {
    expect(decks.length).toBeGreaterThan(2);
    let lamps = 0;
    for (let gx = Math.floor(AREA.x / CHUNK) - AREA.r; gx <= Math.floor(AREA.x / CHUNK) + AREA.r; gx++) {
      for (let gz = Math.floor(AREA.z / CHUNK) - AREA.r; gz <= Math.floor(AREA.z / CHUNK) + AREA.r; gz++) {
        for (const p of generateDensityPoints(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, LAMP_PLACEMENT)) {
          lamps++;
          for (const b of decks) expect(besideDeck(b, p.x, p.z)).toBeGreaterThan(b.width / 2 + BRIDGE_CUT_FEATHER - 0.5);
        }
      }
    }
    expect(lamps).toBeGreaterThan(20);
  });

  it("carries every freeway mouth at a city river on a freeway deck, or ends its lane paint short of the river", () => {
    const r = AREA.r * CHUNK;
    const mouths = getFreewayMouths(AREA.x - r, AREA.z - r, AREA.x + r, AREA.z + r);
    expect(mouths.length).toBeGreaterThan(2);
    let decked = 0;
    for (const m of mouths) {
      const served = decks.some((b) => {
        const ends = [b.path[0], b.path[b.path.length - 1]];
        return b.width > 20 && (ends.some((e) => Math.hypot(e.x - m.x, e.z - m.z) < 24) || besideDeck(b, m.x + m.dx * 12, m.z + m.dz * 12) < b.width / 2);
      });
      if (served) {
        decked++;
        continue;
      }
      // A road meeting a river's END is no crossing: it runs on dry round the end's bank (a belt round a
      // river ending at full width in the city, (-4929, 971) warped), paint and all.
      const w = warp(m.x, m.z);
      const nearest = riverPiecesNear(w.x, w.z, w.x, w.z, riverKeepOff() * 3).sort((p, q) => distanceToSegment(w.x, w.z, p.sx, p.sz, p.ex, p.ez) - distanceToSegment(w.x, w.z, q.sx, q.sz, q.ex, q.ez))[0];
      if (nearest && riverPieceEnds(nearest).some(Boolean)) {
        expect(computeVertexData(m.x, m.z).waterDepth > 0).toBe(false);
        continue;
      }
      // A dead end reads as one: no lane dashes (nor the raised markers that follow them) run up to the river.
      for (const back of [0, 6, 12]) expect(computeVertexData(m.x - m.dx * back, m.z - m.dz * back).distanceToFreewayCenter).toBeGreaterThan(99990);
    }
    expect(decked).toBeGreaterThan(1);
  });

  it("leaves no piece of road a river cut off that is too small for anything to stand on (-16250, 15200)", () => {
    // A belt sliver north of a river, standing alone in its sand.
    const [x0, z0, x1, z1] = [-16900, 14600, -15600, 15800];
    const S = 8;
    const road = new Set<string>();
    for (let x = x0; x < x1; x += S) {
      for (let z = z0; z < z1; z += S) {
        const v = computeVertexData(x, z);
        if (v.distanceToRoadCenter < 9.5 && !(v.waterHeight > v.height)) road.add(`${x / S},${z / S}`);
      }
    }
    expect(road.size).toBeGreaterThan(500);
    const seen = new Set<string>();
    for (const k of road) {
      if (seen.has(k)) continue;
      const stack = [k];
      seen.add(k);
      let n = 0;
      let border = false;
      while (stack.length) {
        const [i, j] = stack.pop()!.split(",").map(Number);
        n++;
        if (i * S <= x0 + S || i * S >= x1 - 2 * S || j * S <= z0 + S || j * S >= z1 - 2 * S) border = true;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const q = `${i + a},${j + b}`;
          if (road.has(q) && !seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
      if (!border) expect(n * S * S).toBeGreaterThan(5000);
    }
  });
});

describe("a world without <Rivers>", () => {
  it("has no river anywhere", () => {
    initCompute(DOMAIN_CONFIGS.home);
    expect(riversEnabled).toBe(false);
    expect(riverPiecesNear(-5000, -5000, 5000, 5000, 1000)).toEqual([]);
    expect(computeVertexData(123, 456).distanceToRiverCenter).toBe(Infinity);
  });
});
