/** The water mesh never shows on a river's dry bank: every terrain vertex the water is reported at
 *  outside the channel stands at or above that water, at each LOD's vertex spacing. The water mesh
 *  and the terrain share one grid per chunk and interpolate linearly on the same triangles, so a
 *  vertex-level guarantee holds across every triangle. (A bank blended down from the rim puts the
 *  ground under the surface, and a second strip of water shows on the sand.) */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { LAKE_BIOME } from "../../../world/domains/overworld/regions/ocean/biomes/lake/spec";
import { computeVertexData, computeVertexDataFar, computeVertexDataRaw, getRiverSegments, initCompute, unwarp, warp } from "../vertexCompute";
import { RIVER_BLOCK_WATER } from "./constants";
import { riverPieceBuilt, riverPiecesNear } from "./riverNetwork";
import { riverEdgeBlocked } from "./riverPieceRules";
import { lastShoreDistance } from "../lakes";

const config = OVERWORLD_CONFIG;

beforeAll(() => initCompute(config));

/** River pieces (warped) with no lake within 800u: the reported water is the river's. */
const dryLandPieces = () => {
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
        for (let a = 0; a < 8 && !lake; a++) {
          for (const r of [200, 500, 800]) {
            if (computeVertexDataRaw(mid.x + Math.cos(a) * r, mid.z + Math.sin(a) * r).biomeId === LAKE_BIOME.id) lake = true;
          }
        }
        if (lake) continue;
        const l = Math.hypot(s.ex - s.sx, s.ez - s.sz) || 1;
        out.push({ x: mid.x, z: mid.z, ux: (s.ex - s.sx) / l, uz: (s.ez - s.sz) / l, w: Math.max(s.w0, s.w1) });
      }
    }
  }
  return out;
};

describe("river banks", () => {
  it("never report water above the ground outside the channel, at LOD1–LOD3 vertex spacings", () => {
    const pieces = dryLandPieces();
    expect(pieces.length).toBeGreaterThan(2);
    const { halfWidth, bank } = config.river;
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
            if (Number.isNaN(v.waterHeight) || v.biomeId === LAKE_BIOME.id || !(v.distanceToRiverCenter > halfWidth)) continue;
            checked++;
            expect(v.waterHeight).toBeLessThanOrEqual(v.height + 1e-6);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("run on to their other stretch or into the water across any gap under 800u that is not mountain", () => {
    // Rivers connect to the water near them (no river in blobs between two seas). Per edge: every stretch of unbuilt pieces up to RIVER_GAP_FILL long
    // with river or water on both sides reaches the mountain's rock (code 4) or a prohibited biome (2).
    const pieces = riverPiecesNear(-12000, -12000, 12000, 12000, 0);
    const edges = new Map(pieces.map((p) => [p.edge.key, p.edge]));
    let gaps = 0;
    let stretches = 0;
    for (const e of edges.values()) {
      const b = e.blocked!;
      const step = e.len / e.count;
      for (let i = 0; i < e.count; ) {
        if (b[i] === 0 || b[i] === 1) {
          if (b[i] === 0 && (i === 0 || b[i - 1] !== 0)) stretches++;
          i++;
          continue;
        }
        let j = i;
        while (j + 1 < e.count && b[j + 1] !== 0 && b[j + 1] !== 1) j++;
        const riverish = (k: number) => k >= 0 && k < e.count && (b[k] === 0 || b[k] === 1);
        if (riverish(i - 1) && riverish(j + 1) && (j - i + 1) * step <= 800) {
          gaps++;
          expect(Array.from(b.slice(i, j + 1)).some((c) => c === 2 || c === 4)).toBe(true);
        }
        i = j + 1;
      }
    }
    expect(stretches).toBeGreaterThan(50);
    expect(edges.size).toBeGreaterThan(50);
    // Some mountain gaps remain (the rock): the test must see them to mean anything.
    expect(gaps).toBeGreaterThan(0);
  });

  it("open into the lake at a mouth: no bank rim in the water, no river water above the lake's", () => {
    // A mouth: a built piece whose next piece along its edge lies deep in water. Around each, wherever
    // the lake covers the river-free ground, the river may only deepen it — its rim stood a levee in
    // the water between the river and the lake.
    const mouths: { x: number; z: number }[] = [];
    for (const p of riverPiecesNear(-8400, -8400, 8400, 8400, 0)) {
      if (mouths.length >= 8 || !riverPieceBuilt(p)) continue;
      const blocked = riverEdgeBlocked(p.edge);
      if (blocked[p.index + 1] === RIVER_BLOCK_WATER) mouths.push(unwarp(p.ex, p.ez));
      else if (blocked[p.index - 1] === RIVER_BLOCK_WATER) mouths.push(unwarp(p.sx, p.sz));
    }
    expect(mouths.length).toBeGreaterThan(4);
    const reach = config.river.halfWidth + config.river.bank;
    let lakebed = 0;
    for (const m of mouths) {
      for (let x = m.x - 240; x <= m.x + 240; x += 12) {
        for (let z = m.z - 240; z <= m.z + 240; z += 12) {
          const v = computeVertexData(x, z);
          if (!(v.distanceToRiverCenter < reach)) continue;
          const lake = computeVertexDataFar(x, z, false);
          if (!(lake.waterHeight > lake.height)) continue;
          lakebed++;
          expect(v.height).toBeLessThanOrEqual(lake.height + 1e-6);
          expect(v.waterHeight).toBeCloseTo(lake.waterHeight, 6);
        }
      }
    }
    expect(lakebed).toBeGreaterThan(500);
  });

  it("merge into a lake close beside them: no levee between, one water, the far bank kept", () => {
    // A river running along an ocean shore ~30–130u off it, snow on the far side (Evan's screenshot): a
    // strip of land stood between the two waters (1670 such 6u samples over the 3 km square around it).
    // (Away from where it turns into the lake: its mouth's corners see both waters too.)
    const cx = 9520;
    const cz = -5330;
    const half = 222;
    const step = 6;
    const n = (2 * half) / step + 1;
    const { halfWidth, bank } = config.river;
    const band = halfWidth + bank * 0.5;
    const grid: { wet: number; h: number; w: number }[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = computeVertexData(cx - half + j * step, cz - half + i * step);
        const wet = v.waterHeight > v.height + 0.05;
        // 1 = the river's water, 2 = the lake's
        grid.push({ wet: !wet ? 0 : v.biomeId !== LAKE_BIOME.id && v.distanceToRiverCenter < band ? 1 : 2, h: v.height, w: v.waterHeight });
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
          const first = (sign: number) => {
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
    // The far bank stands: across every piece here, on the side away from the lake, the bank past the
    // water band is dry — away from the lake's wall (within ~75u of it is the corner where the river turns
    // into the lake, which merges too).
    let banks = 0;
    const w = warp(cx, cz);
    for (const p of riverPiecesNear(w.x - half, w.z - half, w.x + half, w.z + half, 0)) {
      if (!riverPieceBuilt(p)) continue;
      const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const nx = -(p.ez - p.sz) / len;
      const nz = (p.ex - p.sx) / len;
      const mx = (p.sx + p.ex) / 2;
      const mz = (p.sz + p.ez) / 2;
      const lakeAt = (sign: number) => {
        const q = unwarp(mx + nx * 250 * sign, mz + nz * 250 * sign);
        return computeVertexDataFar(q.x, q.z, false).biomeId === LAKE_BIOME.id;
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
    expect(banks).toBeGreaterThan(20);
  });

  it("are absent from the far LODs that skip the river field: no water, no bed paint, no trench", () => {
    for (const p of dryLandPieces()) {
      const carved = computeVertexDataFar(p.x, p.z);
      if (!(carved.distanceToRiverCenter < config.river.halfWidth)) continue;
      const dry = computeVertexDataFar(p.x, p.z, false);
      expect(dry.distanceToRiverCenter).toBe(Infinity);
      expect(dry.riverBedDistance).toBe(Infinity);
      expect(dry.waterHeight).toBeNaN();
      expect(dry.height).toBeGreaterThan(carved.height);
    }
  });
});
