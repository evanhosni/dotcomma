/** The round-17 rules (CHANGES.md §2.23), on the real compute module with the overworld's shared config:
 *  the terrain MESH (its triangles, LOD1 and LOD2) never rises through a deck; no deck edge stands raised,
 *  nor a parapet, over road pavement; every T/Y crotch is filleted; and an inter-city freeway's
 *  cross-section is flat — one grade per centerline point — where it runs along or across a biome or
 *  region wall. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PARAPET_HEIGHT, BRIDGE_PLACEMENT } from "../../../objects/dressing/bridges/bridgeSpec";
import { crotchFlares } from "./deckGeometry";
import { bridgeDrawn, bridgeDrawnAt } from "./drawnSlab";
import { pavedAt } from "./landings";
import {
  type FreewayBridge,
  bridgeParapetAt,
  bridgeSections,
  computeVertexData,
  computeVertexDataRaw,
  freewayPointAt,
  getFreewayBridges,
  getNetwork,
  initCompute,
  setDeckCutSpacing,
  unwarp,
  warp,
} from "../vertexCompute";

const CHUNK = 256;
const LOD1 = 420 / 96;
const LOD2 = 420 / 24;

const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out: FreewayBridge[] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

/** The terrain as its chunk mesh draws it at lattice spacing sp: vertex heights on the triangles
 *  (diagonal from (x0, z1) to (x1, z0), as the terrain worker builds them). */
const meshHeights = new Map<string, number>();
const vertexHeight = (sp: number, x: number, z: number): number => {
  const key = `${sp},${x},${z}`;
  let h = meshHeights.get(key);
  if (h === undefined) {
    setDeckCutSpacing(sp);
    h = computeVertexData(x, z).height;
    setDeckCutSpacing(LOD1);
    meshHeights.set(key, h);
  }
  return h;
};
const meshAt = (sp: number, x: number, z: number): number => {
  const x0 = Math.floor(x / sp) * sp;
  const z0 = Math.floor(z / sp) * sp;
  const u = (x - x0) / sp;
  const v = (z - z0) / sp;
  const a = vertexHeight(sp, x0, z0);
  const b = vertexHeight(sp, x0 + sp, z0);
  const c = vertexHeight(sp, x0 + sp, z0 + sp);
  const d = vertexHeight(sp, x0, z0 + sp);
  return u + v <= 1 ? a + (b - a) * u + (d - a) * v : c + (d - c) * (1 - u) + (b - c) * (1 - v);
};

/** The drawn slab as the ribbon's triangles, sampled about every `step` units. */
const slabPoints = (b: FreewayBridge, step: number, visit: (x: number, z: number, top: number, t: number) => void): void => {
  const S = bridgeSections(b);
  const corner = (q: (typeof S)[number], lat: number) => [q.x + q.ax * lat, q.z + q.az * lat, q.y + q.slope * lat, q.t];
  for (let i = 0; i + 1 < S.length; i++) {
    const a = S[i];
    const c = S[i + 1];
    const aL = corner(a, a.wl);
    const aR = corner(a, -a.wr);
    const cR = corner(c, -c.wr);
    const cL = corner(c, c.wl);
    for (const T of [
      [aL, aR, cR],
      [aL, cR, cL],
    ]) {
      const span = Math.max(Math.hypot(T[1][0] - T[0][0], T[1][1] - T[0][1]), Math.hypot(T[2][0] - T[0][0], T[2][1] - T[0][1]), Math.hypot(T[2][0] - T[1][0], T[2][1] - T[1][1]));
      const n = Math.max(1, Math.ceil(span / step));
      for (let p = 0; p <= n; p++) {
        for (let q = 0; p + q <= n; q++) {
          const l1 = p / n;
          const l2 = q / n;
          const at = (k: number) => T[0][k] * (1 - l1 - l2) + T[1][k] * l1 + T[2][k] * l2;
          visit(at(0), at(1), at(2), at(3));
        }
      }
    }
  }
};

describe("round-17 deck and freeway ground rules", () => {
  let decks: FreewayBridge[] = [];
  beforeAll(() => {
    initCompute(OVERWORLD_CONFIG);
    decks = [
      // Cut landings on a belt corner and a run's end, both skewed.
      ...decksNear(-7600, -13940, 1),
      // Y merges: a mouth's deck teeing into a pair's deck.
      ...decksNear(1624, -7817, 1),
      ...decksNear(3619, 1474, 1),
    ];
  });

  it("finds cut landings and T/Y crotches to check", () => {
    expect(decks.length).toBeGreaterThan(6);
    expect(decks.some((b) => crotchFlares(b).length > 0)).toBe(true);
  });

  it("keeps the terrain mesh under every deck, LOD1 and LOD2 triangles included", () => {
    const cfg = OVERWORLD_CONFIG.cityConfig;
    for (const sp of [LOD1, LOD2]) {
      let bad = 0;
      let worst = 0;
      for (const b of decks) {
        slabPoints(b, 2, (x, z, top, t) => {
          // (A RAMPED landed end's first 3 units dive under its road by design; a LOD2 triangle reaching
          // from the road in front of it over the dive carries the road on a few units further, 0.2u over.)
          const s = t * b.length;
          const fromRamp = Math.min(b.landings?.[0] && !b.trimStartAxis ? s : Infinity, b.landings?.[1] && !b.trimEndAxis ? b.length - s : Infinity);
          if (fromRamp <= (sp === LOD1 ? 3 : 6)) return;
          const g = meshAt(sp, x, z);
          // (A flush landed seam stands 0.05 over the top; the road's own curb within 0.3 at a cut end.)
          if (g > top + 0.06 && (g - top > 0.3 || computeVertexData(x, z).distanceToRoadCenter >= cfg.roadWidth + 1)) {
            bad++;
            worst = Math.max(worst, g - top);
          }
        });
      }
      expect({ sp, bad, worst }).toEqual({ sp, bad: 0, worst: 0 });
    }
  });

  it("raises no deck edge and stands no parapet over road pavement", () => {
    let ledges = 0;
    let walls = 0;
    for (const b of decks) {
      const S = bridgeSections(b);
      for (let i = 0; i + 1 < S.length; i++) {
        const a = S[i];
        const c = S[i + 1];
        const len = Math.hypot(c.x - a.x, c.z - a.z);
        const n = Math.max(1, Math.ceil(len));
        for (let k = 0; k < n; k++) {
          const f = k / n;
          const t = a.t + (c.t - a.t) * f;
          for (const side of [1, -1] as const) {
            const w = side === 1 ? a.wl + (c.wl - a.wl) * f : a.wr + (c.wr - a.wr) * f;
            const x = a.x + (c.x - a.x) * f + (a.ax + (c.ax - a.ax) * f) * side * w;
            const z = a.z + (c.z - a.z) * f + (a.az + (c.az - a.az) * f) * side * w;
            if (!pavedAt(x, z)) continue;
            const top = a.y + (c.y - a.y) * f + (a.slope + (c.slope - a.slope) * f) * side * w;
            if (top - computeVertexDataRaw(x, z).height > 0.25) ledges++;
            const wall = a.wall + (c.wall - a.wall) * f;
            if (bridgeParapetAt(b, t, side) && wall * BRIDGE_PARAPET_HEIGHT > 0.05) walls++;
          }
        }
      }
    }
    expect({ ledges, walls }).toEqual({ ledges: 0, walls: 0 });
  });

  it("fillets every T/Y crotch: the slab runs on unbroken into the corner's wedge", () => {
    let crotches = 0;
    for (const b of decks) {
      for (const f of crotchFlares(b)) {
        crotches++;
        expect(f.radius).toBeGreaterThanOrEqual(4);
        // Along the crotch's bisector from its corner J, the slab (the child's or its host's) covers at
        // least a radius-4 fillet's depth, R·(1/sin(θ/2) − 1).
        let bx = f.ux + f.hx;
        let bz = f.uz + f.hz;
        const bl = Math.hypot(bx, bz) || 1;
        bx /= bl;
        bz /= bl;
        const need = 4 * (1 / Math.sin(f.theta / 2) - 1);
        for (let r = 0.25; r <= Math.min(need, 30); r += 0.25) {
          const x = f.jx + bx * r;
          const z = f.jz + bz * r;
          const on = decks.some((d) => {
            bridgeDrawnAt(d, x, z, 0);
            return bridgeDrawn.weight >= 1 && Number.isNaN(bridgeDrawn.flush) && Number.isFinite(bridgeDrawn.own);
          });
          expect({ at: [Math.round(x), Math.round(z)], on }).toEqual({ at: [Math.round(x), Math.round(z)], on: true });
        }
      }
    }
    expect(crotches).toBeGreaterThan(0);
  });

  it("gives an inter-city freeway one grade per centerline point across biome and region walls", () => {
    // City|grass and grass|desert edges along runs (59/60's kind): five points across the asphalt.
    const areas = [
      [-18771, -10520],
      [-16567, -6653],
      [-9477, -17431],
      [-8986, -15979],
      [-7589, -15441],
    ];
    let sections = 0;
    let tilted = 0;
    let worst = 0;
    const seen = new Set<string>();
    for (const [cx, cz] of areas) {
      for (const run of getNetwork(warp(cx, cz)).freeways) {
        for (let s = 0; s < run.length; s += 8) {
          const p = freewayPointAt(run, s);
          const w = unwarp(p.x, p.z);
          if (Math.abs(w.x - cx) > 150 || Math.abs(w.z - cz) > 150) continue;
          const key = `${Math.round(w.x)},${Math.round(w.z)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const pq = freewayPointAt(run, Math.min(run.length, s + 2));
          const po = freewayPointAt(run, Math.max(0, s - 2));
          const q = unwarp(pq.x, pq.z);
          const o = unwarp(po.x, po.z);
          const l = Math.hypot(q.x - o.x, q.z - o.z) || 1;
          const nx = -(q.z - o.z) / l;
          const nz = (q.x - o.x) / l;
          const hs: number[] = [];
          const zones = new Set<number>();
          let onAsphalt = true;
          for (const off of [-12, -6, 0, 6, 12]) {
            const v = computeVertexData(w.x + nx * off, w.z + nz * off);
            if (v.biomeId === 1 || !(v.distanceToRoadCenter < 7) || v.riverBedDistance < 58 || v.underDeck > 0) onAsphalt = false;
            hs.push(v.height);
            zones.add(v.regionId * 100 + v.biomeId);
          }
          if (!onAsphalt || zones.size < 2) continue;
          sections++;
          const tilt = Math.abs(hs[4] - hs[0]);
          worst = Math.max(worst, tilt);
          if (tilt > 0.5) tilted++;
        }
      }
    }
    expect(sections).toBeGreaterThan(40);
    // (What is left twists through a sharp bend of a steep run.)
    expect(tilted / sections).toBeLessThan(0.05);
    expect(worst).toBeLessThan(2);
  });
});
