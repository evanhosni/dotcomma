/** A water source's DISC in the river field (generation/water/rivers/field/index.ts): injected on flat ground, on a slope and over a
 *  calm river, it carves a wet pool, keeps the banks' invariant (no dry vertex shows water above its
 *  ground) at LOD1–LOD3 spacings, and joins the river with no step in the water. */
import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { CITY_BIOME_ID } from "../../../../../world/constants";
import { computeVertexData, initCompute, unwarp } from "../../../..";
import { getBiomeContext } from "../../../../zones";
import { WATER_BELOW_GROUND } from "../../../constants";
import type { FieldDisc } from "../../../types";
import { PIECE_GORGE } from "../../enums";
import { injectFieldDiscs, riverFieldAt, riverSample } from "..";
import { riverPiecesNear } from "../../network";
import { riverPondDiscsIn } from "../../ponds";
import { gorgedCodes } from "../../gaps";
import { waterGroundAt } from "../../../utils";
import { isLakeBiome } from "../../../lakes/params";

const CONFIG = DOMAIN_CONFIGS.overworld;
const { halfWidth, bank } = CONFIG.river;
const R = 60;

const disc = (x: number, z: number, level: number): FieldDisc => ({ x, z, width: R / halfWidth, level, depth: 1.1, amount: 0.15, lobes: 3, phase: 1.7, body: -1 });

/** Ground spread over a disc's waterline (warped), and whether the spot is open land: no river, lake or city. */
const spread = (x: number, z: number): number => {
  const hs = [0, 1, 2, 3].map((a) => waterGroundAt(x + Math.cos((a * Math.PI) / 2) * R, z + Math.sin((a * Math.PI) / 2) * R).h);
  return Math.max(...hs) - Math.min(...hs);
};
const openLand = (x: number, z: number): boolean => {
  riverFieldAt(x, z, false, false);
  if (riverSample.distance < Infinity) return false;
  const ctx = getBiomeContext({ x, z });
  if (ctx.zone.biome.id === CITY_BIOME_ID || isLakeBiome(ctx.zone.biome)) return false;
  return Number.isNaN(waterGroundAt(x, z).level);
};

describe("a water source's disc in the river field", () => {
  const discs: FieldDisc[] = [];
  beforeAll(() => {
    initCompute(CONFIG);
    let flat: FieldDisc | null = null;
    let slope: FieldDisc | null = null;
    for (let x = -6000; x <= 6000 && !(flat && slope); x += 370) {
      for (let z = -6000; z <= 6000 && !(flat && slope); z += 410) {
        if (!openLand(x, z)) continue;
        const s = spread(x, z);
        const level = waterGroundAt(x, z).h - WATER_BELOW_GROUND;
        if (!flat && s < 4) flat = disc(x, z, level);
        else if (!slope && s > 25 && s < 60) slope = disc(x, z, level);
      }
    }
    // Over a calm river, at its own surface: the pool a river widens into.
    let river: FieldDisc | null = null;
    for (const p of riverPiecesNear(-6000, -6000, 6000, 6000, 0)) {
      const mx = (p.sx + p.ex) / 2;
      const mz = (p.sz + p.ez) / 2;
      if (getBiomeContext({ x: mx, z: mz }).zone.biome.id === CITY_BIOME_ID) continue;
      // Away from the ponds the river holds itself (generation/water/rivers/ponds/index.ts), whose levels hold its joints.
      if (riverPondDiscsIn(mx - 500, mz - 500, mx + 500, mz + 500).length > 0) continue;
      riverFieldAt(mx, mz, false, false);
      if (riverSample.shore < Infinity || gorgedCodes(p.edge)[p.index] === PIECE_GORGE || riverSample.distance > 2) continue;
      const level = riverSample.surface;
      const l = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const ux = (p.ex - p.sx) / l;
      const uz = (p.ez - p.sz) / l;
      // Calm across the whole footprint (~130u each way): beside one falling into a lowered lake, the disc's
      // level met the river's descent in a 1.8u step.
      let calm = true;
      for (const along of [-160, -80, 80, 160]) {
        riverFieldAt(mx + ux * along, mz + uz * along, false, false);
        if (!(Math.abs(riverSample.surface - level) <= 2)) calm = false;
      }
      if (!calm) continue;
      river = disc(mx, mz, level);
      break;
    }
    for (const d of [flat, slope, river]) if (d) discs.push(d);
    injectFieldDiscs(discs);
  });
  afterAll(() => injectFieldDiscs(null));

  it("found a flat spot, a slope and a calm river to stand discs on", () => {
    expect(discs.length).toBe(3);
  });

  it("is a carved, wet pool at its centre", () => {
    for (const d of discs) {
      const at = unwarp(d.x, d.z);
      const v = computeVertexData(at.x, at.z);
      expect(v.waterHeight).toBeCloseTo(d.level, 0);
      expect(v.waterHeight - v.height).toBeGreaterThan(1.5);
    }
  });

  it("never reports water above the ground past its waterline, at LOD1–LOD3 spacings", () => {
    let checked = 0;
    for (const d of discs) {
      const c = unwarp(d.x, d.z);
      const span = (halfWidth + bank) * d.width * (1 + d.amount) + 30;
      for (const spacing of [4.375, 8.75, 17.5]) {
        for (let x = Math.floor((c.x - span) / spacing) * spacing; x <= c.x + span; x += spacing) {
          for (let z = Math.floor((c.z - span) / spacing) * spacing; z <= c.z + span; z += spacing) {
            const v = computeVertexData(x, z);
            if (Number.isNaN(v.waterHeight) || !(v.distanceToRiverCenter > halfWidth)) continue;
            checked++;
            expect(v.waterHeight).toBeLessThanOrEqual(v.height + 1e-6);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(300);
  });

  it("joins the river it stands on with no step in the water", () => {
    const d = discs[2];
    const c = unwarp(d.x, d.z);
    const S = 4.375;
    // Its footprint, where its water and the river's meet (a river's own grade steps farther along it).
    const reach = (halfWidth + bank) * d.width * (1 + d.amount);
    const n = Math.ceil(reach / S);
    const grid: number[][] = [];
    for (let i = -n; i <= n; i++) {
      const row: number[] = [];
      for (let j = -n; j <= n; j++) {
        const v = Math.hypot(i, j) * S > reach ? null : computeVertexData(c.x + i * S, c.z + j * S);
        row.push(v && v.waterHeight > v.height ? v.waterHeight : NaN);
      }
      grid.push(row);
    }
    let worst = 0;
    let pairs = 0;
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid.length; j++) {
        for (const [a, b] of [[i + 1, j], [i, j + 1]]) {
          if (a >= grid.length || b >= grid.length || Number.isNaN(grid[i][j]) || Number.isNaN(grid[a][b])) continue;
          pairs++;
          worst = Math.max(worst, Math.abs(grid[i][j] - grid[a][b]));
        }
      }
    }
    expect(pairs).toBeGreaterThan(300);
    // 0.5 until the river's water hung under its LOWER bank (Nov 2026): its joints' water varies with the
    // banks now, and where the disc's level meets it the largest step is 0.55u over 4.375u.
    expect(worst).toBeLessThan(0.6);
  });
});
