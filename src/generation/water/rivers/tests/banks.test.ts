import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { biomeById } from "../../../registry";
import { lastShoreDistance } from "../../lakes";
import { computeVertexData, computeVertexDataFar, computeVertexDataRaw, getRiverSegments, initCompute, unwarp, warp } from "../../..";
import { riverFieldAt, riverSample } from "../field";
import { PIECE_BUILT, PIECE_GORGE, PIECE_HIGH, PIECE_MOUNTAIN, PIECE_WATER, pieceBuilt } from "../enums";
import { RIVER_SHAPED_MAX, RIVER_WIDTH_JITTER } from "../constants";
import { POND_DEFAULTS } from "../../ponds/params";
import { gorgedCodes } from "../gaps";
import { finalEdge, riverPieceBuilt, riverPiecesNear, baseJointSurface } from "../network";
import { waterGroundAt } from "../../utils";
import type { RiverEdge, RiverPiece } from "../types";
import { isLakeBiome } from "../../lakes/params";
import { RIVERS } from "../../params";

/** The channel on the ground and where a river is built (water/channel/, generation/water/rivers/network/index.ts, generation/water/rivers/gaps/index.ts):
 *  no water drawn over a dry bank at any LOD's spacing, a carved channel, far LODs blind to rivers, a
 *  mouth opening into its lake and a river close beside one merging into it, widths in bounds, and no
 *  short gap left between two stretches of one river that a gorge could have carved. */

const CONFIG = DOMAIN_CONFIGS.overworld;
const { halfWidth, bank } = CONFIG.river;

/** Every river edge with a built piece in a warped square around the origin. */
const edgesNear = (r: number): RiverEdge[] => {
  const edges = new Map<string, RiverEdge>();
  for (const p of riverPiecesNear(-r, -r, r, r, 0)) edges.set(p.edge.key, p.edge);
  return [...edges.values()];
};
/** Every `step`th built piece of those edges. */
const somePieces = (r: number, step: number): RiverPiece[] => riverPiecesNear(-r, -r, r, r, 0).filter((_, i) => i % step === 0);

describe("the river channel", () => {
  beforeAll(() => initCompute(CONFIG));

  it("draws no water over a dry bank: past the half-width the ground stands over the river's water", () => {
    let checked = 0;
    for (const p of somePieces(4000, 9)) {
      const mx = (p.sx + p.ex) / 2;
      const mz = (p.sz + p.ez) / 2;
      const l = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const nx = -(p.ez - p.sz) / l;
      const nz = (p.ex - p.sx) / l;
      const w = (p.w0 + p.w1) / 2;
      // LOD1 spacing across the whole footprint.
      for (let d = -(halfWidth + bank) * w; d <= (halfWidth + bank) * w; d += 4.375) {
        const at = unwarp(mx + nx * d, mz + nz * d);
        const v = computeVertexDataRaw(at.x, at.z);
        if (!(v.distanceToRiverCenter >= halfWidth) || Number.isNaN(v.waterHeight)) continue;
        // Lake water is the lake's (a mouth; a merge, which sinks the land between a river and a lake
        // under the level): only a river's own water away from every lake is judged here.
        riverFieldAt(warp(at.x, at.z).x, warp(at.x, at.z).z, false, false);
        if (riverSample.shore < Infinity || !Number.isNaN(computeVertexDataFar(at.x, at.z, false).waterHeight)) continue;
        checked++;
        expect(v.waterHeight).toBeLessThanOrEqual(v.height + 0.05);
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("carves the channel under the water at the centerline", () => {
    let wet = 0;
    let checked = 0;
    for (const p of somePieces(4000, 7)) {
      const at = unwarp((p.sx + p.ex) / 2, (p.sz + p.ez) / 2);
      if (!Number.isNaN(computeVertexDataFar(at.x, at.z, false).waterHeight)) continue;
      const v = computeVertexDataRaw(at.x, at.z);
      if (v.underDeck > 0) continue;
      checked++;
      if (v.waterHeight > v.height + 1) wet++;
    }
    expect(checked).toBeGreaterThan(20);
    // A meander can carry the centerline sample onto the channel's flank; nearly all are deep water.
    expect(wet).toBeGreaterThan(checked * 0.9);
  });

  it("is invisible to far LODs that skip rivers: no channel, no water, no bed paint", () => {
    for (const p of somePieces(4000, 11)) {
      const at = unwarp((p.sx + p.ex) / 2, (p.sz + p.ez) / 2);
      const v = computeVertexDataFar(at.x, at.z, false);
      expect(v.distanceToRiverCenter).toBe(Infinity);
      expect(v.riverBedDistance).toBe(Infinity);
      expect(v.waterFlowX).toBe(0);
    }
  });
});

describe("the river network", () => {
  beforeAll(() => initCompute(CONFIG));

  it("keeps every joint's width within the jitter, the climbs' narrowing, the ocean's widening and the end shapes", () => {
    for (const e of edgesNear(6000)) {
      finalEdge(e);
      for (const w of e.widths!) {
        expect(w).toBeGreaterThanOrEqual((1 - RIVER_WIDTH_JITTER) * POND_DEFAULTS.summitStream - 1e-9);
        expect(w).toBeLessThanOrEqual(RIVER_SHAPED_MAX + 1e-9);
      }
    }
  });

  it("leaves no short gap between two stretches of one river that a gorge could carve", () => {
    let gaps = 0;
    for (const e of edgesNear(8000)) {
      const codes = gorgedCodes(e);
      const L = e.len / e.count;
      for (let i = 1; i < e.count - 1; i++) {
        if (!pieceBuilt(codes[i - 1]) || pieceBuilt(codes[i])) continue;
        let j = i;
        while (j < e.count && (codes[j] === PIECE_HIGH || codes[j] === PIECE_MOUNTAIN)) j++;
        if (j >= e.count || (codes[j] !== PIECE_BUILT && codes[j] !== PIECE_GORGE) || (j - i) * L > e.rules.gapFill) continue;
        gaps++;
        // Its real ground rises past the carve over the line between its two waters.
        const v0 = baseJointSurface(e, i);
        const v1 = baseJointSurface(e, j);
        let rise = -Infinity;
        for (let s = i * L + 5; s < j * L; s += 10) rise = Math.max(rise, waterGroundAt(e.ax + e.ux * s, e.az + e.uz * s).h - (v0 + ((v1 - v0) * (s - i * L)) / ((j - i) * L)));
        expect(rise).toBeGreaterThan(e.rules.maxCarve - 5);
      }
    }
    expect(gaps).toBeGreaterThanOrEqual(0);
  });
});

const inLake = (biomeId: number): boolean => isLakeBiome(biomeById(biomeId) ?? {});

/** Up to six river pieces (world midpoint, warped direction, widest factor) with no lake within 800u: the
 *  water reported around them is the river's. */
const dryLandPieces = (): { x: number; z: number; ux: number; uz: number; w: number }[] => {
  const out: { x: number; z: number; ux: number; uz: number; w: number }[] = [];
  const G = 2800;
  for (let ix = -2; ix <= 1 && out.length < 6; ix++) {
    for (let iz = -2; iz <= 1 && out.length < 6; iz++) {
      const q = { x: 1237 + G * (ix + 0.5), z: 811 + G * (iz + 0.5) };
      for (const s of getRiverSegments(q)) {
        if (out.length >= 6) break;
        const mx = (s.sx + s.ex) / 2;
        const mz = (s.sz + s.ez) / 2;
        if (Math.abs(mx - q.x) > G / 2 || Math.abs(mz - q.z) > G / 2 || s.index % 7 !== 3) continue;
        const mid = unwarp(mx, mz);
        let lake = false;
        for (let a = 0; a < 8 && !lake; a++) for (const r of [200, 500, 800]) if (inLake(computeVertexDataRaw(mid.x + Math.cos(a) * r, mid.z + Math.sin(a) * r).biomeId)) lake = true;
        if (lake) continue;
        const l = Math.hypot(s.ex - s.sx, s.ez - s.sz) || 1;
        out.push({ x: mid.x, z: mid.z, ux: (s.ex - s.sx) / l, uz: (s.ez - s.sz) / l, w: Math.max(s.w0, s.w1) });
      }
    }
  }
  return out;
};

describe("river banks", () => {
  beforeAll(() => initCompute(CONFIG));

  it("never report water above the ground outside the channel, at LOD1–LOD3 vertex spacings", () => {
    const pieces = dryLandPieces();
    expect(pieces.length).toBeGreaterThan(2);
    let checked = 0;
    for (const p of pieces) {
      const half = (halfWidth + bank) * p.w * 1.7 + 40;
      for (const [spacing, far] of [
        [4.375, false],
        [17.5, false],
        [210, true],
      ] as const) {
        const span = Math.max(half, far ? 420 : 0);
        for (let x = Math.floor((p.x - span) / spacing) * spacing; x <= p.x + span; x += spacing) {
          for (let z = Math.floor((p.z - span) / spacing) * spacing; z <= p.z + span; z += spacing) {
            // Only a band along the piece (its footprint), not the whole square at LOD1.
            if (!far && Math.abs((x - p.x) * p.ux + (z - p.z) * p.uz) > 60) continue;
            const v = far ? computeVertexDataFar(x, z) : computeVertexData(x, z);
            if (Number.isNaN(v.waterHeight) || inLake(v.biomeId) || !(v.distanceToRiverCenter > halfWidth)) continue;
            checked++;
            expect(v.waterHeight).toBeLessThanOrEqual(v.height + 1e-6);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("open into the lake at a mouth: no bank rim in the water, no river water above the lake's", () => {
    // A mouth: a built piece whose next piece along its edge lies deep in water. Wherever the lake covers
    // the ground around it the river may only deepen it: its rim stood a levee in the water.
    const mouths: { x: number; z: number }[] = [];
    for (const p of riverPiecesNear(-8400, -8400, 8400, 8400, 0)) {
      if (mouths.length >= 8 || !riverPieceBuilt(p)) continue;
      const codes = gorgedCodes(p.edge);
      if (codes[p.index + 1] === PIECE_WATER) mouths.push(unwarp(p.ex, p.ez));
      else if (codes[p.index - 1] === PIECE_WATER) mouths.push(unwarp(p.sx, p.sz));
    }
    expect(mouths.length).toBeGreaterThan(4);
    const reach = halfWidth + bank;
    const carved: [number, number, number, number][] = [];
    for (const m of mouths) {
      for (let x = m.x - 240; x <= m.x + 240; x += 12) {
        for (let z = m.z - 240; z <= m.z + 240; z += 12) {
          const v = computeVertexData(x, z);
          if (v.distanceToRiverCenter < reach) carved.push([x, z, v.height, v.waterHeight]);
        }
      }
    }
    // The lake as it lies with no river at all: the same world with its rivers turned off.
    const dry = <T extends { features?: Readonly<Record<string, unknown>> }>(b: T): T =>
      b.features?.[RIVERS] ? { ...b, features: { ...b.features, [RIVERS]: { ...(b.features[RIVERS] as object), chance: 0 } } } : b;
    const riverless = { ...CONFIG, regions: CONFIG.regions.map((r) => ({ ...r, riverChance: 0, biomes: r.biomes.map(dry) })) };
    initCompute(riverless);
    let lakebed = 0;
    try {
      for (const [x, z, height, waterHeight] of carved) {
        const lake = computeVertexDataFar(x, z, false);
        if (!(lake.waterHeight > lake.height)) continue;
        lakebed++;
        expect(height).toBeLessThanOrEqual(lake.height + 1e-6);
        expect(waterHeight).toBeCloseTo(lake.waterHeight, 6);
      }
    } finally {
      initCompute(CONFIG);
    }
    expect(lakebed).toBeGreaterThan(500);
  });

  it("merge into a lake close beside them: no levee between, one water, the far bank kept (9520, -5330)", () => {
    // A river along an ocean shore ~30–130u off it, snow on the far side: a strip of land stood between
    // the two waters. (Away from where it turns into the lake: its mouth's corners see both waters too.)
    const cx = 9520;
    const cz = -5330;
    const half = 222;
    const step = 6;
    const n = (2 * half) / step + 1;
    const band = halfWidth + bank * 0.5;
    const grid: { wet: number; w: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = computeVertexData(cx - half + j * step, cz - half + i * step);
        const wet = v.waterHeight > v.height + 0.05;
        // 1 = the river's water, 2 = the lake's.
        grid.push({ wet: !wet ? 0 : !inLake(v.biomeId) && v.distanceToRiverCenter < band ? 1 : 2, w: v.waterHeight });
      }
    }
    let levee = 0;
    let wetPairs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const g = grid[i * n + j];
        for (const [di, dj] of [[0, 1], [1, 0]]) {
          if (i + di >= n || j + dj >= n) continue;
          const o = grid[(i + di) * n + j + dj];
          if (g.wet && o.wet) {
            wetPairs++;
            expect(Math.abs(g.w - o.w)).toBeLessThan(0.5);
          }
        }
        if (g.wet) continue;
        for (const [di, dj] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
          const first = (sign: number): number => {
            for (let k = 1; k <= 10; k++) {
              const a = i + di * k * sign;
              const b = j + dj * k * sign;
              if (a < 0 || a >= n || b < 0 || b >= n) return 0;
              if (grid[a * n + b].wet) return grid[a * n + b].wet;
            }
            return 0;
          };
          const a = first(1);
          const b = first(-1);
          if (a && b && a !== b) levee++;
        }
      }
    }
    expect(wetPairs).toBeGreaterThan(5000);
    expect(levee).toBe(0);
    // The far bank stands: on the side away from the lake the bank past the water band is dry, away from
    // the lake's wall (within ~100u of it the river turning into the lake merges too).
    let banks = 0;
    const w = warp(cx, cz);
    for (const p of riverPiecesNear(w.x - half, w.z - half, w.x + half, w.z + half, 0)) {
      if (!riverPieceBuilt(p)) continue;
      const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const nx = -(p.ez - p.sz) / len;
      const nz = (p.ex - p.sx) / len;
      const mx = (p.sx + p.ex) / 2;
      const mz = (p.sz + p.ez) / 2;
      const lakeAt = (sign: number): boolean => {
        const q = unwarp(mx + nx * 250 * sign, mz + nz * 250 * sign);
        return inLake(computeVertexDataFar(q.x, q.z, false).biomeId);
      };
      const away = lakeAt(1) && !lakeAt(-1) ? -1 : lakeAt(-1) && !lakeAt(1) ? 1 : 0;
      if (!away) continue;
      const f = Math.min(p.w0, p.w1);
      for (let d = band * f + 8; d <= (halfWidth + bank) * f; d += 6) {
        const q = unwarp(mx + nx * d * away, mz + nz * d * away);
        computeVertexDataFar(q.x, q.z, false);
        if (lastShoreDistance() < 100) continue;
        const v = computeVertexData(q.x, q.z);
        banks++;
        expect(Number.isNaN(v.waterHeight) || v.waterHeight <= v.height + 1e-6).toBe(true);
      }
    }
    expect(banks).toBeGreaterThan(10);
  });

  it("are absent from the far LODs that skip the river field: no water, no bed paint, no trench", () => {
    let checked = 0;
    for (const p of dryLandPieces()) {
      const carved = computeVertexDataFar(p.x, p.z);
      if (!(carved.distanceToRiverCenter < halfWidth)) continue;
      const dry = computeVertexDataFar(p.x, p.z, false);
      checked++;
      expect(dry.distanceToRiverCenter).toBe(Infinity);
      expect(dry.riverBedDistance).toBe(Infinity);
      expect(dry.waterHeight).toBeNaN();
      expect(dry.height).toBeGreaterThan(carved.height);
    }
    expect(checked).toBeGreaterThan(0);
  });
});
