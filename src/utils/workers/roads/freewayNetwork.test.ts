/** Every cell's network routes a city pair the same way: the terrain draws a run from its vertex's own
 *  cell's network and the bridges from their window's, so a leg one cell has and its neighbor lacks
 *  is a road ending at the cell border and a deck over no road. Around (3391, 10827), where the
 *  shortest-path heap compared its entries by the live distance and two neighbors routed one pair
 *  1606u and 1666u (a run through the mountains drawn in one cell, a deck on the other route). */
import { DOMAIN_CONFIGS } from "../../../world/domains";
import { initCompute } from "../vertexCompute";
import { domainConfig } from "../computeConfig";
import { getNetwork } from "./freewayNetwork";

beforeAll(() => initCompute(DOMAIN_CONFIGS.overworld));

/** Each leg of a network's runs, keyed by its rounded ends (either direction), with its midpoint. */
const legsOf = (ix: number, iz: number): Map<string, [number, number]> => {
  const gs = domainConfig!.gridSize;
  const legs = new Map<string, [number, number]>();
  for (const run of getNetwork({ x: (ix + 0.5) * gs, z: (iz + 0.5) * gs }).freeways) {
    for (let k = 0; k + 3 < run.pts.length; k += 2) {
      const [ax, az, bx, bz] = run.pts.slice(k, k + 4).map((v) => Math.round(v * 10));
      const key = ax < bx || (ax === bx && az <= bz) ? `${ax},${az},${bx},${bz}` : `${bx},${bz},${ax},${az}`;
      legs.set(key, [(run.pts[k] + run.pts[k + 2]) / 2, (run.pts[k + 1] + run.pts[k + 3]) / 2]);
    }
  }
  return legs;
};

test("two neighboring cells agree on every freeway leg between them", () => {
  const gs = domainConfig!.gridSize;
  const cache = new Map<string, Map<string, [number, number]>>();
  const legs = (ix: number, iz: number) => {
    const k = `${ix},${iz}`;
    let v = cache.get(k);
    if (!v) cache.set(k, (v = legsOf(ix, iz)));
    return v;
  };
  let compared = 0;
  const disagree: string[] = [];
  for (let ix = 2; ix <= 9; ix++) {
    for (let iz = 18; iz <= 25; iz++) {
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const a = legs(ix, iz);
        const b = legs(ix + dx, iz + dz);
        const inPair = ([mx, mz]: [number, number]) => {
          const cx = Math.floor(mx / gs);
          const cz = Math.floor(mz / gs);
          return (cx === ix && cz === iz) || (cx === ix + dx && cz === iz + dz);
        };
        for (const [one, other] of [[a, b], [b, a]]) {
          for (const [key, mid] of one) {
            if (!inPair(mid)) continue;
            compared++;
            if (!other.has(key)) disagree.push(`${Math.round(mid[0])},${Math.round(mid[1])}`);
          }
        }
      }
    }
  }
  expect(compared).toBeGreaterThan(50);
  expect(disagree).toEqual([]);
});
