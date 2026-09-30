/** The inter-city run lamps (getFreewayRunLamps / the `freewayLamps` enumerator) on the real compute
 *  module with the overworld's shared config: determinism, chunk-order independence, and every
 *  exclusion (city, water, decks, the verge/shoulder placement, the arm over the road). */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { CITY_BIOME_ID } from "../../../world/constants";
import { FREEWAY_CORRIDOR_INNER, FREEWAY_CORRIDOR_OUTER } from "../../../world/shaders/constants";
import { computeVertexData, computeVertexDataRaw, freewayPointAt, getNetwork, initCompute, riverKeepOff, unwarp, warp } from "../vertexCompute";
import { DRESSING_COLLIDER_SPECS } from "../../../objects/dressing/catalog";
import { runDressingEnumerator } from "../../../objects/dressing/enumerators";
import { DRESSING_CHUNK_SIZE } from "../../../objects/dressing/types";
import { FREEWAY_LAMPS_SPEC, FREEWAY_LAMP_PLACEMENT, LAMP_HEAD_OFFSET_X } from "../../../objects/dressing/street-lamps/lampSpec";
import { type FreewayLampPoint, getFreewayRunLamps } from "./runLamps";

const C = DRESSING_CHUNK_SIZE;
const P = FREEWAY_LAMP_PLACEMENT;
const key = (p: { x: number; z: number }) => `${p.x.toFixed(4)}|${p.z.toFixed(4)}`;

let chunks: [number, number][] = [];
const lampsIn = (order: [number, number][]): FreewayLampPoint[] =>
  order.flatMap(([i, j]) => getFreewayRunLamps(i * C, j * C, (i + 1) * C, (j + 1) * C, P));

beforeAll(() => {
  initCompute(OVERWORLD_CONFIG);
  // The longest inter-city run near the origin whose middle lies outside every city.
  let best: { x: number; z: number; length: number } | null = null;
  for (const run of getNetwork(warp(0, 0)).freeways) {
    const w = freewayPointAt(run, run.length / 2);
    const mid = unwarp(w.x, w.z);
    if (computeVertexDataRaw(mid.x, mid.z).biomeId === CITY_BIOME_ID) continue;
    if (!best || run.length > best.length) best = { ...mid, length: run.length };
  }
  expect(best).not.toBeNull();
  const ci = Math.floor(best!.x / C);
  const cj = Math.floor(best!.z / C);
  for (let i = ci - 3; i <= ci + 3; i++) for (let j = cj - 3; j <= cj + 3; j++) chunks.push([i, j]);
});

describe("getFreewayRunLamps", () => {
  it("places lamps along the run, deterministic and duplicate-free under any chunk order", () => {
    const forward = lampsIn(chunks);
    expect(forward.length).toBeGreaterThan(10);
    expect(new Set(forward.map(key)).size).toBe(forward.length);
    const reverse = lampsIn([...chunks].reverse());
    const shuffled = lampsIn([...chunks].sort((a, b) => ((a[0] * 7919 + a[1] * 104729) % 97) - ((b[0] * 7919 + b[1] * 104729) % 97)));
    const set = new Set(forward.map(key));
    for (const other of [reverse, shuffled]) {
      expect(other.length).toBe(forward.length);
      for (const p of other) expect(set.has(key(p))).toBe(true);
    }
  });

  it("stands every lamp on the verge or the shoulder of a run, arm over the road, off city, water and decks", () => {
    const toReal = OVERWORLD_CONFIG.cityConfig.freewayWidth / OVERWORLD_CONFIG.cityConfig.roadWidth;
    const verge = FREEWAY_CORRIDOR_OUTER * toReal + P.verge;
    const shoulder = FREEWAY_CORRIDOR_INNER * toReal + P.shoulder;
    for (const p of lampsIn(chunks)) {
      const vd = computeVertexData(p.x, p.z);
      expect(vd.biomeId).not.toBe(CITY_BIOME_ID);
      expect(vd.distanceToRiverCenter).toBeGreaterThanOrEqual(riverKeepOff());
      expect(vd.underDeck).toBe(0);
      if (!Number.isNaN(vd.waterHeight)) expect(vd.waterHeight).toBeLessThan(vd.height);
      const real = vd.distanceToRoadCenter * toReal;
      expect(Math.min(Math.abs(real - verge), Math.abs(real - shoulder))).toBeLessThan(0.75);
      // Never floating: at or below the ground under its center.
      expect(p.y).toBeLessThanOrEqual(vd.height + 1e-9);
      // The arm reaches toward the road.
      const head = computeVertexData(p.x + Math.cos(p.yaw) * LAMP_HEAD_OFFSET_X, p.z - Math.sin(p.yaw) * LAMP_HEAD_OFFSET_X);
      expect(head.distanceToRoadCenter).toBeLessThan(vd.distanceToRoadCenter);
    }
  });

  it("is the `freewayLamps` enumerator the server's obstacles build from", () => {
    expect(DRESSING_COLLIDER_SPECS).toContain(FREEWAY_LAMPS_SPEC);
    const [i, j] = chunks.find(([ci, cj]) => getFreewayRunLamps(ci * C, cj * C, (ci + 1) * C, (cj + 1) * C, P).length > 0)!;
    const bounds = { minX: i * C, minZ: j * C, maxX: (i + 1) * C, maxZ: (j + 1) * C };
    const points = runDressingEnumerator(FREEWAY_LAMPS_SPEC.enumerator, bounds, FREEWAY_LAMPS_SPEC.placement);
    expect(points).toEqual(getFreewayRunLamps(bounds.minX, bounds.minZ, bounds.maxX, bounds.maxZ, P));
    for (const p of points) expect(FREEWAY_LAMPS_SPEC.bodiesOf(p)).toEqual([{ x: p.x, y: p.y, z: p.z, yaw: p.yaw }]);
  });
});
