/** Where roads meet rivers (CHANGES.md §2.20): nothing is placed on a deck, a freeway reaching a
 *  city river is carried on a deck or ends short of it, and no tiny piece of road is left standing
 *  where a river cut it off. On the real compute module with the overworld's shared config. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PLACEMENT } from "../../../objects/dressing/bridges/bridgeSpec";
import { LAMP_PLACEMENT } from "../../../objects/dressing/street-lamps/lampSpec";
import { generateDensityPoints } from "../densityPoints";
import { BRIDGE_CUT_FEATHER } from "../bridges/constants";
import { type FreewayBridge, computeVertexData, getFreewayBridges, getFreewayMouths, initCompute } from "../vertexCompute";

const CHUNK = 256;


/** Every deck owned by a chunk within r chunks of (cx, cz). */
const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out: FreewayBridge[] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      out.push(...getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));
    }
  }
  return out;
};

/** Distance from a point to a deck's centerline, beside it (past its ends: Infinity). */
const besideDeck = (b: FreewayBridge, x: number, z: number): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < b.path.length; i++) {
    const a = b.path[i];
    const c = b.path[i + 1];
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
    if (t < 0 || t > 1) continue;
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
};

/** A city river with arterials on both banks (the bridge tests' area): its mouths pair across it. */
const AREA = { x: -4400, z: 700, r: 3 };

describe("roads at rivers", () => {
  let decks: FreewayBridge[] = [];
  beforeAll(() => {
    initCompute(OVERWORLD_CONFIG);
    decks = decksNear(AREA.x, AREA.z, AREA.r);
  });

  it("places no street lamp on or beside a deck", () => {
    expect(decks.length).toBeGreaterThan(2);
    let lamps = 0;
    for (let gx = Math.floor(AREA.x / CHUNK) - AREA.r; gx <= Math.floor(AREA.x / CHUNK) + AREA.r; gx++) {
      for (let gz = Math.floor(AREA.z / CHUNK) - AREA.r; gz <= Math.floor(AREA.z / CHUNK) + AREA.r; gz++) {
        for (const p of generateDensityPoints(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, LAMP_PLACEMENT)) {
          lamps++;
          // No street lamp in the middle of a deck.
          for (const b of decks) expect(besideDeck(b, p.x, p.z)).toBeGreaterThan(b.width / 2 + BRIDGE_CUT_FEATHER - 0.5);
        }
      }
    }
    expect(lamps).toBeGreaterThan(20);
  });

  it("carries every freeway mouth at a city river on a freeway deck, or ends its lane paint short of the river", () => {
    const r = AREA.r * CHUNK;
    const mouths = getFreewayMouths(AREA.x - r, AREA.z - r, AREA.x + r, AREA.z + r);
    expect(mouths.length).toBeGreaterThan(2);
    let decked = 0;
    for (const m of mouths) {
      const served = decks.some((b) => {
        const ends = [b.path[0], b.path[b.path.length - 1]];
        return b.width > 20 && (ends.some((e) => Math.hypot(e.x - m.x, e.z - m.z) < 24) || besideDeck(b, m.x + m.dx * 12, m.z + m.dz * 12) < b.width / 2);
      });
      if (served) {
        decked++;
        continue;
      }
      // A dead end reads as one: no lane dashes (nor the raised markers that follow them) run up to the river.
      for (const back of [0, 6, 12]) expect(computeVertexData(m.x - m.dx * back, m.z - m.dz * back).distanceToFreewayCenter).toBeGreaterThan(99990);
    }
    expect(decked).toBeGreaterThan(1);
  });

  it("leaves no piece of road a river cut off that is too small for anything to stand on", () => {
    // A belt sliver north of a river, standing alone in its sand (3648u² of pavement and lane paint
    // without the fragment pass).
    const [x0, z0, x1, z1] = [-16900, 14600, -15600, 15800];
    const S = 8;
    const road = new Set<string>();
    for (let x = x0; x < x1; x += S) {
      for (let z = z0; z < z1; z += S) {
        const v = computeVertexData(x, z);
        if (v.distanceToRoadCenter < 9.5 && !(v.waterHeight > v.height)) road.add(`${x / S},${z / S}`);
      }
    }
    expect(road.size).toBeGreaterThan(500);
    const seen = new Set<string>();
    for (const k of road) {
      if (seen.has(k)) continue;
      const stack = [k];
      seen.add(k);
      let n = 0;
      let border = false;
      while (stack.length) {
        const [i, j] = stack.pop()!.split(",").map(Number);
        n++;
        if (i * S <= x0 + S || i * S >= x1 - 2 * S || j * S <= z0 + S || j * S >= z1 - 2 * S) border = true;
        for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const q = `${i + a},${j + b}`;
          if (road.has(q) && !seen.has(q)) {
            seen.add(q);
            stack.push(q);
          }
        }
      }
      if (!border) expect(n * S * S).toBeGreaterThan(5000);
    }
  });
});
