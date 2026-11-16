/** Where the riverbed paint ends (rivers/bedLimit.ts): at the first steep step of a rock bank, never to
 *  resume beyond it, never inside the half-width; untouched on flat banks, every other ground and in the
 *  city. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { CITY_BIOME_ID } from "../../../../world/constants";
import { RIVER_BED_FADE_INSET, RIVER_BED_FULL_INSET } from "../../../../world/shaders/constants";
import { lastShoreDistance } from "../lakes";
import { computeVertexData, computeVertexDataFar, initCompute, unwarp, warp } from "../../vertexCompute";
import { capRiverBed } from "./bedLimit";
import { riverFieldAt, riverSample } from "./field";
import { riverPieceBuilt, riverPiecesNear } from "./network";
import { pondDiscsIn } from "../ponds";

const CONFIG = DOMAIN_CONFIGS.overworld;
const { halfWidth, bank } = CONFIG.river;
const REACH = halfWidth + bank;

describe("capRiverBed", () => {
  beforeAll(() => initCompute(CONFIG));

  it("leaves the bed inward of its limit's fade, and pushes it out of the paint's reach from the limit on", () => {
    const limit = 60;
    expect(capRiverBed(40, limit)).toBe(40);
    expect(capRiverBed(limit - 8, limit)).toBe(limit - 8);
    for (const d of [limit, limit + 5, REACH - 2]) expect(capRiverBed(d, limit)).toBeGreaterThanOrEqual(REACH - RIVER_BED_FADE_INSET);
  });

  it("never fades inside the half-width (a steep bank at the water's edge keeps its bed under the water)", () => {
    for (let d = 0; d < halfWidth; d += 2) expect(capRiverBed(d, halfWidth)).toBe(d);
  });

  it("is no limit at all from the reach on", () => {
    for (let d = 0; d < REACH; d += 5) expect(capRiverBed(d, REACH)).toBe(d);
  });
});

describe("the bed limit", () => {
  beforeAll(() => initCompute(CONFIG));

  it("is never computed for the city", () => {
    for (const p of riverPiecesNear(-3000, -3000, 3000, 3000, 0).slice(0, 20)) {
      riverFieldAt((p.sx + p.ex) / 2, (p.sz + p.ez) / 2, true);
      expect(riverSample.bedLimit).toBe(Infinity);
    }
  });

  it("leaves every bank away from rock painted as the river's own distance", () => {
    let checked = 0;
    for (const p of riverPiecesNear(-3000, -3000, 3000, 3000, 0).filter((_, i) => i % 5 === 0)) {
      const l = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      for (const d of [0.5, 0.8]) {
        const w = (p.w0 + p.w1) / 2;
        const at = unwarp((p.sx + p.ex) / 2 - ((p.ez - p.sz) / l) * REACH * w * d, (p.sz + p.ez) / 2 + ((p.ex - p.sx) / l) * REACH * w * d);
        riverFieldAt(warp(at.x, at.z).x, warp(at.x, at.z).z, false, true);
        // Rock (a limit), and a lake beside (a merge paints the land between as bed), are not this test's.
        if (riverSample.bedLimit < REACH || riverSample.shore < Infinity) continue;
        const v = computeVertexData(at.x, at.z);
        if (v.biomeId === CITY_BIOME_ID || !Number.isNaN(computeVertexDataFar(at.x, at.z, false).waterHeight) || v.underDeck > 0) continue;
        checked++;
        expect(v.riverBedDistance).toBeCloseTo(v.distanceToRiverCenter, 6);
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("leaves flat banks alone: off the city and lakes the bed reaches the river's full reach", () => {
    // Banks with no slope over 25° anywhere in reach, away from ponds (a pond's own limit, marched round its
    // bowl, meets the river's by a soft minimum): the paint distance is the river distance.
    let checked = 0;
    for (const [cx, cz] of [
      [3000, -2400],
      [-15251, 872],
    ]) {
      const w = warp(cx, cz);
      const discs = pondDiscsIn(w.x - 2000, w.z - 2000, w.x + 2000, w.z + 2000);
      const clear = (p: { sx: number; sz: number }) => discs.every((d) => Math.hypot(p.sx - d.x, p.sz - d.z) > REACH * d.width * 2 + 100);
      for (const p of riverPiecesNear(w.x - 1500, w.z - 1500, w.x + 1500, w.z + 1500, 0).filter(riverPieceBuilt).filter(clear).slice(0, 16)) {
        const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
        const ux = (p.ex - p.sx) / len;
        const uz = (p.ez - p.sz) / len;
        const f = Math.max(p.w0, p.w1);
        const ray: { bed: number; dr: number; h: number; skip: boolean }[] = [];
        for (let d = 0; d <= REACH * f; d += 4) {
          const q = unwarp((p.sx + p.ex) / 2 - uz * d, (p.sz + p.ez) / 2 + ux * d);
          const v = computeVertexData(q.x, q.z);
          // Beside a lake the mouth and the merge hand the bed to the lake (no merge reaches past 300u).
          const lake = !Number.isNaN(computeVertexDataFar(q.x, q.z, false).waterHeight) || lastShoreDistance() < 300;
          ray.push({ bed: v.riverBedDistance, dr: v.distanceToRiverCenter, h: v.height, skip: v.biomeId === CITY_BIOME_ID || lake });
        }
        const flat = ray.every((s, i) => i === 0 || Math.abs(s.h - ray[i - 1].h) < 4 * Math.tan((25 * Math.PI) / 180));
        if (!flat || ray.some((s) => s.skip)) continue;
        for (const s of ray) {
          if (!(s.dr < REACH)) continue;
          checked++;
          expect(s.bed).toBe(s.dr);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("ends where its rock bank first gets steep and never resumes beyond (5295, -4782)", () => {
    const c = warp(5295, -4782);
    const resumed: string[] = [];
    for (const p of riverPiecesNear(c.x - 600, c.z - 600, c.x + 600, c.z + 600, 0)) {
      const l = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const w = (p.w0 + p.w1) / 2;
      for (const t of [0.25, 0.75]) {
        for (const side of [1, -1]) {
          let ended = false;
          for (let d = halfWidth * w; d < (REACH - RIVER_BED_FULL_INSET) * w; d += 2) {
            const at = unwarp(p.sx + (p.ex - p.sx) * t - ((p.ez - p.sz) / l) * d * side, p.sz + (p.ez - p.sz) * t + ((p.ex - p.sx) / l) * d * side);
            const v = computeVertexData(at.x, at.z);
            if (v.biomeId === CITY_BIOME_ID || v.underDeck > 0) break;
            if (ended && v.riverBedDistance <= REACH - RIVER_BED_FULL_INSET) resumed.push(`${at.x.toFixed(1)},${at.z.toFixed(1)}`);
            if (v.riverBedDistance >= REACH - RIVER_BED_FADE_INSET && v.distanceToRiverCenter < REACH - RIVER_BED_FULL_INSET) ended = true;
          }
        }
      }
    }
    expect(resumed).toEqual([]);
  });
});
