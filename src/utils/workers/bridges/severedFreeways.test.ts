/** No freeway is severed by water (CHANGES.md §2.22): wherever a run, a belt or a city arterial meets
 *  a river, a deck carries it across or the river gives way — and where a deck lands on its road by a
 *  cut, the road and the deck are one surface. On the real compute module with the overworld's
 *  shared config, over the round's example spots and the round-15 open items. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PLACEMENT } from "../../../objects/dressing/bridges/bridgeSpec";
import { getSeveredFreeways } from "./severed";
import { type FreewayBridge, bridgeSections, computeVertexData, computeVertexDataRaw, getFreewayBridges, initCompute } from "../vertexCompute";

const CHUNK = 256;

/** A run stranded at a belt corner on the bank (/outer-quarter/hazel-ville), a pond between two
 *  freeway stubs (/golden-hoarlands/zonal-dome), the confluence at (10300, -1950), the run deck that grazed a river end (7116, -14842), a pond pinching a belt corner
 *  (-17377, 11627), a run ending against a rounded deck (23400, -4314). */
const SPOTS: [number, number][] = [
  [6033, 1138],
  [10250, -1850],
  [10300, -1950],
  [7116, -14842],
  [-17377, 11627],
  [23400, -4314],
];
const HALF = 700;

const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out: FreewayBridge[] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

beforeAll(() => initCompute(OVERWORLD_CONFIG));

test("no freeway around the example spots is cut by water", () => {
  for (const [x, z] of SPOTS) {
    const severed = getSeveredFreeways(x - HALF, z - HALF, x + HALF, z + HALF);
    expect(severed.map((s) => `${Math.round(s.x)},${Math.round(s.z)} ${s.kind}/${s.shape}`)).toEqual([]);
  }
});

test("hazel-ville's stranded run is carried across the river", () => {
  // The run ending at the city's corner on the upper bank (6016, 1131) lands on a freeway deck.
  const decks = decksNear(6033, 1138, 2);
  const served = decks.some((b) => b.width > 20 && b.path.some((p) => Math.hypot(p.x - 6016, p.z - 1131) < 60));
  expect(served).toBe(true);
});

test("a landed cut end is one surface with its road", () => {
  let ends = 0;
  for (const [x, z] of SPOTS) {
    for (const b of decksNear(x, z, 2)) {
      const S = bridgeSections(b);
      for (const which of [0, 1] as const) {
        const axis = which === 0 ? b.trimStartAxis : b.trimEndAxis;
        const landing = b.landings?.[which];
        if (!axis || !landing || landing.ramp > 0) continue;
        ends++;
        const e = which === 0 ? S[0] : S[S.length - 1];
        const q = which === 0 ? S[1] : S[S.length - 2];
        const l0 = Math.hypot(q.x - e.x, q.z - e.z) || 1;
        const dx = (q.x - e.x) / l0;
        const dz = (q.z - e.z) / l0;
        for (let l = -b.width / 2 + 2; l <= b.width / 2 - 2; l += 2) {
          const px = e.x + e.ax * l - dx * 0.1;
          const pz = e.z + e.az * l - dz * 0.1;
          const v = computeVertexData(px, pz);
          // Asphalt right up to the cut (no curb across the mouth) wherever the road's own asphalt lies
          // ahead of it along the deck — a deck wider than the road it carries on keeps that road's
          // curb beside it — at the cut's own height.
          let ahead = false;
          for (let d = 0; d <= 12 && !ahead; d += 0.25) ahead = computeVertexDataRaw(px - dx * d, pz - dz * d).distanceToRoadCenter < 6.7;
          if (ahead) expect(v.distanceToRoadCenter).toBeLessThan(7);
          expect(Math.abs(v.height - (e.y + e.slope * l))).toBeLessThan(0.15);
        }
      }
    }
  }
  expect(ends).toBeGreaterThan(0);
});
