/** The city's blocks beside its EDGE roads (belt, arterials): no block island too small for a
 *  building, no wide asphalt fill where a block fits, the road flat where an island was taken out, no
 *  pole in a plaza, and the field is the same in any query order. The area is the corner of a city where
 *  the belt, two arterials and a run meet, which held all-road rim cells, their leftover islands and a
 *  sliver between the belt and an arterial before. A second area, where a city meets a river mouth,
 *  held plaza and sidewalk on the river's bank. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../../world/constants";
import { UTILITY_POLE_PLACEMENT } from "../../../objects/dressing/power-lines/poleSpec";
import { computeVertexData, computeVertexDataRaw, initCompute } from "../vertexCompute";
import { getCityFreewayEdgePoints } from "./cityFeatures";

const STEP = 2;
const X0 = 4950;
const Z0 = 550;
const N = 250; // 500u square
const BUILD_FIELD = 23; // building/spec.ts roadDistanceRange
const ISLAND_MIN_AREA = 16; // a raster speck along a curb is not an island
const FILL_DT = 40; // a freeway×freeway crossing's own asphalt reaches ~32u from its corners, a merge ~38u

const REACH = OVERWORLD_CONFIG.river.halfWidth + OVERWORLD_CONFIG.river.bank;

interface Raster {
  field: Float64Array;
  height: Float64Array;
  river: Float64Array;
  cls: Uint8Array; // 0 other, 1 block land, 2 asphalt, 3 curb, 4 riverbed
  city: Uint8Array;
}

const sample = (order: number[], x0 = X0, z0 = Z0): Raster => {
  initCompute(OVERWORLD_CONFIG);
  const r: Raster = { field: new Float64Array(N * N), height: new Float64Array(N * N), river: new Float64Array(N * N), cls: new Uint8Array(N * N), city: new Uint8Array(N * N) };
  for (const k of order) {
    const v = computeVertexData(x0 + ((k % N) + 0.5) * STEP, z0 + (Math.floor(k / N) + 0.5) * STEP);
    const f = v.distanceToRoadCenter;
    const bed = v.riverBedDistance < REACH - 1 && f >= 12;
    r.field[k] = f;
    r.height[k] = v.height;
    r.river[k] = v.distanceToRiverCenter;
    r.city[k] = v.biomeId === CITY_BIOME_ID ? 1 : 0;
    r.cls[k] = v.waterHeight > v.height ? 0 : f < 7 ? 2 : f < 8 ? 3 : bed ? 4 : r.city[k] ? 1 : 0;
  }
  return r;
};

const forward = [...Array(N * N).keys()];
let raster: Raster;
beforeAll(() => {
  raster = sample(forward);
});

const neighbors = (k: number): number[] => {
  const i = k % N;
  const j = Math.floor(k / N);
  const out: number[] = [];
  if (i > 0) out.push(k - 1);
  if (i < N - 1) out.push(k + 1);
  if (j > 0) out.push(k - N);
  if (j < N - 1) out.push(k + N);
  return out;
};

describe("city blocks beside the edge roads", () => {
  it("has the edge roads and blocks this test is about", () => {
    let land = 0;
    let asphalt = 0;
    for (let k = 0; k < N * N; k++) {
      if (!raster.city[k]) continue;
      if (raster.cls[k] === 1) land++;
      if (raster.cls[k] === 2) asphalt++;
    }
    expect(land).toBeGreaterThan(N * N * 0.2);
    expect(asphalt).toBeGreaterThan(N * N * 0.1);
  });

  it("leaves no block island no building could stand on", () => {
    const seen = new Uint8Array(N * N);
    const islands: string[] = [];
    for (let k = 0; k < N * N; k++) {
      if (raster.cls[k] !== 1 || seen[k]) continue;
      const queue = [k];
      seen[k] = 1;
      let count = 0;
      let max = 0;
      let open = false;
      while (queue.length) {
        const p = queue.pop()!;
        count++;
        max = Math.max(max, raster.field[p]);
        const i = p % N;
        const j = Math.floor(p / N);
        if (i === 0 || j === 0 || i === N - 1 || j === N - 1) open = true;
        for (const q of neighbors(p)) {
          if (raster.cls[q] === 4) open = true; // a quay's riverside sidewalk, not an island
          if (raster.cls[q] === 1 && !seen[q]) {
            seen[q] = 1;
            queue.push(q);
          }
        }
      }
      const area = count * STEP * STEP;
      if (!open && max < BUILD_FIELD && area >= ISLAND_MIN_AREA) islands.push(`${X0 + (k % N) * STEP},${Z0 + Math.floor(k / N) * STEP} ${area}u² max ${max.toFixed(1)}`);
    }
    expect(islands).toEqual([]);
  });

  it("leaves no wide asphalt fill in the city", () => {
    // Distance (raster units) from each asphalt sample to the nearest sample that is not asphalt.
    const dt = new Float64Array(N * N);
    for (let k = 0; k < N * N; k++) dt[k] = raster.cls[k] === 2 ? Infinity : 0;
    const D = Math.SQRT2;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const k = j * N + i;
        if (i > 0) dt[k] = Math.min(dt[k], dt[k - 1] + 1);
        if (j > 0) dt[k] = Math.min(dt[k], dt[k - N] + 1, i > 0 ? dt[k - N - 1] + D : Infinity, i < N - 1 ? dt[k - N + 1] + D : Infinity);
      }
    for (let j = N - 1; j >= 0; j--)
      for (let i = N - 1; i >= 0; i--) {
        const k = j * N + i;
        if (i < N - 1) dt[k] = Math.min(dt[k], dt[k + 1] + 1);
        if (j < N - 1) dt[k] = Math.min(dt[k], dt[k + N] + 1, i < N - 1 ? dt[k + N + 1] + D : Infinity, i > 0 ? dt[k + N - 1] + D : Infinity);
      }
    let worst = 0;
    for (let k = 0; k < N * N; k++) if (raster.city[k] && Number.isFinite(dt[k])) worst = Math.max(worst, dt[k] * STEP);
    expect(worst).toBeLessThan(FILL_DT);
  });

  it("lays the road where an island was taken out at the road's own height around it", () => {
    // A removed island's vertex (its raw field was block land, its drawn field is road) lies within the
    // heights of the road around it: the island's plateau left a bump up to 0.6u, its old curb a ring
    // 0.3u high, that the terrain's fake directional shading drew as a dark oval on the road.
    const R = 6;
    let removed = 0;
    const off: string[] = [];
    for (let j = R; j < N - R; j++) {
      for (let i = R; i < N - R; i++) {
        const k = j * N + i;
        if (!raster.city[k] || raster.field[k] >= 5) continue;
        const x = X0 + (i + 0.5) * STEP;
        const z = Z0 + (j + 0.5) * STEP;
        if (computeVertexDataRaw(x, z).distanceToRoadCenter < 5.5) continue;
        removed++;
        let lo = Infinity;
        let hi = -Infinity;
        for (let b = -R; b <= R; b++) {
          for (let a = -R; a <= R; a++) {
            const m = k + b * N + a;
            if (!raster.city[m] || raster.field[m] >= 5) continue;
            if (computeVertexDataRaw(X0 + (i + a + 0.5) * STEP, Z0 + (j + b + 0.5) * STEP).distanceToRoadCenter >= 5) continue;
            lo = Math.min(lo, raster.height[m]);
            hi = Math.max(hi, raster.height[m]);
          }
        }
        if (raster.height[k] > hi + 0.05 || raster.height[k] < lo - 0.05) off.push(`${x},${z} ${raster.height[k].toFixed(2)} in [${lo.toFixed(2)}, ${hi.toFixed(2)}]`);
      }
    }
    expect(removed).toBeGreaterThan(20);
    expect(off).toEqual([]);
  });

  it("stands no utility pole in a plaza", () => {
    const P = UTILITY_POLE_PLACEMENT;
    const poles = getCityFreewayEdgePoints(X0, Z0, X0 + N * STEP, Z0 + N * STEP, P.spacing, P.lateralMargin, P.junctionClear, P.side, false);
    expect(poles.length).toBeGreaterThan(3);
    for (const p of poles) expect(computeVertexData(p.x, p.z).distanceToRoadCenter).toBeLessThan(12);
  });

  it("paints no plaza or sidewalk on a river's bank past the city's edge roads", () => {
    const bank = sample([...Array(N * N).keys()], 2950, 1300);
    // Distance (raster units, capped at 6) from each sample to the nearest asphalt: a road's own
    // sidewalk band (the quay's, the waterfront's) lies within 10u of it.
    const near = new Uint8Array(N * N).fill(255);
    const queue: number[] = [];
    for (let k = 0; k < N * N; k++) {
      if (bank.cls[k] !== 2) continue;
      near[k] = 0;
      queue.push(k);
    }
    for (let h = 0; h < queue.length; h++) {
      const k = queue[h];
      if (near[k] >= 5) continue;
      for (const m of neighbors(k)) {
        if (near[m] !== 255) continue;
        near[m] = near[k] + 1;
        queue.push(m);
      }
    }
    const onBank: string[] = [];
    for (let k = 0; k < N * N; k++) if (bank.cls[k] === 1 && bank.river[k] < REACH - 1 && near[k] === 255) onBank.push(`${2950 + (k % N) * STEP},${1300 + Math.floor(k / N) * STEP}`);
    expect(bank.river.some((d) => d < REACH)).toBe(true);
    expect(onBank).toEqual([]);
  });

  it("is the same field whatever order the city's cells and islands are first asked in", () => {
    const every = forward.filter((k) => k % 7 === 0);
    let s = 12345;
    const shuffled = [...every];
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    for (const order of [[...every].reverse(), shuffled]) {
      const other = sample(order);
      for (const k of every) expect(other.field[k]).toBe(raster.field[k]);
    }
  });
});
