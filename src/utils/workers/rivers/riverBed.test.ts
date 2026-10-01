/** The riverbed paint is CONNECTED to its river: going outward from the channel, once the bank gets
 *  too steep the bed ends and never resumes further out (riverField.ts, capRiverBed). The shader's
 *  per-pixel slope fade alone left a patch of bed wherever the bank flattened again within reach. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../../world/constants";
import { RIVER_BED_FADE_INSET, RIVER_BED_FULL_INSET, RIVER_BED_SLOPE_END_DEG, RIVER_BED_SLOPE_START_DEG } from "../../../world/shaders/constants";
import { smoothstep } from "../../math/_math";
import { computeVertexData, computeVertexDataFar, initCompute, unwarp, warp } from "../vertexCompute";
import { riverPieceBuilt, riverPiecesNear } from "./riverNetwork";

const config = OVERWORLD_CONFIG;
const reach = config.river.halfWidth + config.river.bank;

beforeAll(() => initCompute(config));

const cosDeg = (deg: number) => Math.cos((deg * Math.PI) / 180);
/** What the terrain shader paints there: "water" (the bed goes on under it — a channel, or the ground
 *  cut under a deck), "bed" (the bed's weight over half), "ground", or "city" (pavement: not judged). */
const paintAt = (x: number, z: number): "water" | "bed" | "ground" | "city" => {
  const v = computeVertexData(x, z);
  if (v.biomeId === CITY_BIOME_ID) return "city";
  if (v.waterHeight > v.height || v.underDeck > 0) return "water";
  if (!(v.riverBedDistance < reach)) return "ground";
  const s = 2.1875; // half the LOD1 vertex spacing: the rendered normal's scale
  const gx = (computeVertexData(x + s, z).height - computeVertexData(x - s, z).height) / (2 * s);
  const gz = (computeVertexData(x, z + s).height - computeVertexData(x, z - s).height) / (2 * s);
  const steep = 1 - smoothstep(cosDeg(RIVER_BED_SLOPE_END_DEG), cosDeg(RIVER_BED_SLOPE_START_DEG), 1 / Math.hypot(gx, gz, 1));
  const edge = 1 - smoothstep(reach - RIVER_BED_FULL_INSET, reach - RIVER_BED_FADE_INSET, v.riverBedDistance);
  return edge * (1 - steep) > 0.5 ? "bed" : "ground";
};

/** Whether painted bed around (x0, z0) reaches water within 160u through painted bed (4u lattice). */
const bedReachesWater = (x0: number, z0: number): boolean => {
  const seen = new Set<string>(["0,0"]);
  const queue: [number, number][] = [[0, 0]];
  while (queue.length > 0) {
    const [i, k] = queue.shift()!;
    const p = paintAt(x0 + i * 4, z0 + k * 4);
    if (p === "water") return true;
    if (p !== "bed") continue;
    for (const [a, b] of [[i + 1, k], [i - 1, k], [i, k + 1], [i, k - 1]]) {
      if (seen.has(`${a},${b}`) || Math.hypot(a, b) * 4 > 160) continue;
      seen.add(`${a},${b}`);
      queue.push([a, b]);
    }
  }
  return false;
};

describe("riverbed paint", () => {
  it("ends where its bank first gets steep and does not resume beyond it", () => {
    // A stretch of steep desert banks (salt flat and dunes) that showed 60 cut-off patches before.
    const box = { x0: -4300, z0: -4200, x1: -3900, z1: -3350 };
    const w0 = warp(box.x0, box.z0);
    const w1 = warp(box.x1, box.z1);
    const pieces = riverPiecesNear(Math.min(w0.x, w1.x), Math.min(w0.z, w1.z), Math.max(w0.x, w1.x), Math.max(w0.z, w1.z), 0)
      .filter(riverPieceBuilt)
      .filter((p) => {
        const m = unwarp((p.sx + p.ex) / 2, (p.sz + p.ez) / 2);
        return m.x >= box.x0 && m.x <= box.x1 && m.z >= box.z0 && m.z <= box.z1;
      });
    expect(pieces.length).toBeGreaterThan(8);
    let rays = 0;
    let capped = 0;
    for (const p of pieces) {
      const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
      const ux = (p.ex - p.sx) / len;
      const uz = (p.ez - p.sz) / len;
      const f = Math.max(p.w0, p.w1);
      for (const t of [0.25, 0.75]) {
        for (const side of [1, -1]) {
          rays++;
          // Outward: water (or bed), then ground; bed again after a gap is a patch unless it reaches water.
          let seenBed = false;
          let gap = 0;
          for (let d = 0; d <= reach * f + 10; d += 3) {
            const w = unwarp(p.sx + (p.ex - p.sx) * t - uz * side * d, p.sz + (p.ez - p.sz) * t + ux * side * d);
            const v = computeVertexData(w.x, w.z);
            if (v.riverBedDistance > v.distanceToRiverCenter + 1e-9) capped++;
            const paint = paintAt(w.x, w.z);
            if (paint === "city") break;
            if (paint === "water" || paint === "bed") {
              if (seenBed && gap >= 6 && paint === "bed") expect(bedReachesWater(w.x, w.z)).toBe(true);
              seenBed = true;
              gap = 0;
            } else if (seenBed) gap += 3;
          }
        }
      }
    }
    expect(rays).toBeGreaterThan(30);
    // The limit must actually have acted here, or the test proves nothing.
    expect(capped).toBeGreaterThan(50);
  });

  it("leaves flat banks alone: off the city and lakes the bed reaches the river's full reach", () => {
    // Banks with no slope over 25° anywhere in reach: the paint distance is the river distance.
    let checked = 0;
    for (const [cx, cz] of [
      [3000, -2400],
      [-15251, 872],
    ]) {
      const w = warp(cx, cz);
      for (const p of riverPiecesNear(w.x - 1500, w.z - 1500, w.x + 1500, w.z + 1500, 0).filter(riverPieceBuilt).slice(0, 16)) {
        const len = Math.hypot(p.ex - p.sx, p.ez - p.sz);
        const ux = (p.ex - p.sx) / len;
        const uz = (p.ez - p.sz) / len;
        const f = Math.max(p.w0, p.w1);
        const ray: { bed: number; dr: number; h: number; skip: boolean }[] = [];
        for (let d = 0; d <= reach * f; d += 4) {
          const q = unwarp((p.sx + p.ex) / 2 - uz * d, (p.sz + p.ez) / 2 + ux * d);
          const v = computeVertexData(q.x, q.z);
          // (Beside a lake the mouth hands the bed to the lake: not a flat bank.)
          const lake = !Number.isNaN(computeVertexDataFar(q.x, q.z, false).waterHeight);
          ray.push({ bed: v.riverBedDistance, dr: v.distanceToRiverCenter, h: v.height, skip: v.biomeId === CITY_BIOME_ID || lake });
        }
        const flat = ray.every((s, i) => i === 0 || Math.abs(s.h - ray[i - 1].h) < 4 * Math.tan((25 * Math.PI) / 180));
        if (!flat || ray.some((s) => s.skip)) continue;
        for (const s of ray) {
          if (!(s.dr < reach)) continue;
          checked++;
          expect(s.bed).toBe(s.dr);
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
