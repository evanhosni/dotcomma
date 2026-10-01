/** The round-15 deck rules (CHANGES.md §2.21), over areas with mouth decks between two cities, Y
 *  merges and oblique landings: every deck crosses its river, a freeway-wide deck has freeway at both
 *  ends, a Y is one surface without walls or slabs inside the other deck (its fillets too, and
 *  no stray stub of wall left between openings), and a landed end meets the
 *  road flush wherever its edge lies over pavement. On the real compute module with the overworld's
 *  shared config. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { drawnCovers } from "./drawnSlab";
import { BRIDGE_PLACEMENT, BRIDGE_PARAPET_HEIGHT } from "../../../objects/dressing/bridges/bridgeSpec";
import {
  BRIDGE_PARAPET_WIDTH,
  type FreewayBridge,
  bridgeParapetAt,
  bridgeParapetLine,
  bridgeRiverCrossing,
  bridgeSections,
  computeVertexDataRaw,
  freewayDistanceAt,
  getFreewayBridges,
  initCompute,
} from "../vertexCompute";

const CHUNK = 256;
const MIN_CROSSING = (40 * Math.PI) / 180;

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

/** Distance from a point to a deck's centerline. */
const centerDistance = (b: FreewayBridge, x: number, z: number): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < b.path.length; i++) {
    const a = b.path[i];
    const c = b.path[i + 1];
    const dx = c.x - a.x;
    const dz = c.z - a.z;
    const l2 = dx * dx + dz * dz;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)) : 0;
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
};

/** A T end: trimmed along another deck (no landing there). */
const teeEnd = (b: FreewayBridge, which: 0 | 1): boolean => !!(which === 0 ? b.trimStartAxis : b.trimEndAxis) && !b.landings?.[which];

describe("round-15 deck rules", () => {
  let decks: FreewayBridge[] = [];
  beforeAll(() => {
    initCompute(OVERWORLD_CONFIG);
    decks = [
      // Two cities across a river, a belt corner facing a run's end (a 30/31-like spot).
      ...decksNear(-7600, -13940, 1),
      // Two cities across a river, belt mouths facing each other.
      ...decksNear(-9300, 2330, 1),
      // Y merges: a mouth's deck teeing into the deck of a pair across the river.
      ...decksNear(1624, -7817, 1),
      ...decksNear(3619, 1474, 1),
      // An inter-city run over a river on a ridge (its surface lowered under the road).
      ...decksNear(229, 2912, 1),
    ];
  });

  it("finds mouth decks, Y merges and cut landings to check", () => {
    expect(decks.length).toBeGreaterThan(8);
    expect(decks.filter((b) => teeEnd(b, 0) || teeEnd(b, 1)).length).toBeGreaterThan(1);
    expect(decks.filter((b) => (b.trimStartAxis && b.landings?.[0]) || (b.trimEndAxis && b.landings?.[1])).length).toBeGreaterThan(3);
  });

  it("carries every deck across a river centerline at no less than 40° — a T-child with its host", () => {
    for (const b of decks) {
      const own = bridgeRiverCrossing(b);
      if (!teeEnd(b, 0) && !teeEnd(b, 1)) {
        expect(own.odd).toBe(true);
        expect(own.angle).toBeGreaterThanOrEqual(MIN_CROSSING - 1e-9);
        continue;
      }
      if (own.count > 0) expect(own.angle).toBeGreaterThanOrEqual(MIN_CROSSING - 1e-9);
      if (own.odd) continue;
      // Merging before the centerline: its host crosses.
      const s = bridgeSections(b);
      const at = teeEnd(b, 0) ? s[0] : s[s.length - 1];
      const host = decks.find((o) => o !== b && centerDistance(o, at.x, at.z) < o.width / 2);
      expect(host).toBeDefined();
      const hc = bridgeRiverCrossing(host!);
      expect(hc.odd).toBe(true);
      expect(hc.angle).toBeGreaterThanOrEqual(MIN_CROSSING - 1e-9);
    }
  });

  it("builds a freeway-wide deck only with a freeway at both ends", () => {
    const fw = OVERWORLD_CONFIG.cityConfig.freewayWidth;
    let checked = 0;
    for (const b of decks) {
      if (b.laneScale !== undefined) continue; // a street deck
      const s = bridgeSections(b);
      for (const which of [0, 1] as const) {
        if (!b.landings?.[which]) continue;
        const end = which === 0 ? s[0] : s[s.length - 1];
        expect(freewayDistanceAt(end.x, end.z)).toBeLessThan(fw + 2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("merges a Y into one surface: no parapet inside the other deck, no slab over it past the cut", () => {
    let joins = 0;
    for (const child of decks) {
      for (const which of [0, 1] as const) {
        if (!teeEnd(child, which)) continue;
        const s = bridgeSections(child);
        const at = which === 0 ? s[0] : s[s.length - 1];
        const host = decks.find((o) => o !== child && centerDistance(o, at.x, at.z) < o.width / 2);
        if (!host) continue;
        joins++;
        const inHost = (x: number, z: number, margin: number) => centerDistance(host, x, z) < host.width / 2 - margin;
        const inChild = (x: number, z: number, margin: number) => centerDistance(child, x, z) < child.width / 2 - margin;
        // The child's standing walls stay out of the host's slab.
        const line = bridgeParapetLine(child);
        for (const q of s) {
          for (const side of [1, -1] as const) {
            // A wall ends ON the cut, which lies BRIDGE_TEE_OVERLAP (0.6u) inside the host's edge.
            if (q === at || !bridgeParapetAt(child, q.t, side) || q.wall * BRIDGE_PARAPET_HEIGHT < 0.05) continue;
            expect(inHost(q.x + q.ax * side * line, q.z + q.az * side * line, BRIDGE_PARAPET_WIDTH + 0.05)).toBe(false);
          }
          // Past the cut's section the child's slab lies outside the host's (the cut itself overlaps
          // it by BRIDGE_TEE_OVERLAP, 0.6u).
          if (q === at) continue;
          for (const k of [-0.9, -0.45, 0, 0.45, 0.9]) {
            const lat = (k * child.width) / 2;
            expect(inHost(q.x + q.ax * lat, q.z + q.az * lat, 0.7)).toBe(false);
          }
        }
        // The host's walls open over the child's mouth: none stands inside the child's slab.
        const hs = bridgeSections(host);
        const hl = bridgeParapetLine(host);
        for (const q of hs) {
          for (const side of [1, -1] as const) {
            if (!bridgeParapetAt(host, q.t, side) || q.wall * BRIDGE_PARAPET_HEIGHT < 0.05) continue;
            const x = q.x + q.ax * side * hl;
            const z = q.z + q.az * side * hl;
            // Only beside the child's drawn slab (its trimmed-off part lies over the host).
            if (Math.hypot(x - at.x, z - at.z) > child.width * 3) continue;
            if (centerDistance(host, x, z) > host.width) continue;
            const behindCut = ((x - at.x) * (at.az / Math.hypot(at.ax, at.az)) - (z - at.z) * (at.ax / Math.hypot(at.ax, at.az))) * (which === 0 ? 1 : -1) < 0;
            if (behindCut) continue;
            expect(inChild(x, z, BRIDGE_PARAPET_WIDTH + 0.05)).toBe(false);
          }
        }
      }
    }
    expect(joins).toBeGreaterThan(1);
  });

  it("stands every parapet on the outer edge of merged decks: none inside another's drawn slab, no stubs", () => {
    // Against the DRAWN slab (fillets, flares and cuts included), inside by more than a wall's width
    // all around; a wall's end exactly at an opening's boundary is not a wall.
    const covers = (o: FreewayBridge, x: number, z: number) => drawnCovers(o, x, z, BRIDGE_PARAPET_WIDTH + 0.1);
    let standing = 0;
    let inside = 0;
    let stubs = 0;
    for (const b of decks) {
      const S = bridgeSections(b);
      const line = bridgeParapetLine(b);
      const near = decks.filter((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) < (o.length + b.length) / 2 + 40);
      for (const side of [1, -1] as const) {
        let run = 0;
        let prev: { x: number; z: number } | null = null;
        const end = () => {
          if (run > 0 && run < 3) stubs++;
          run = 0;
          prev = null;
        };
        for (let i = 0; i + 1 < S.length; i++) {
          const a = S[i];
          const c = S[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / 0.5));
          for (let k = i === 0 ? 0 : 1; k <= n; k++) {
            const f = k / n;
            const t = a.t + (c.t - a.t) * f;
            const onBoundary = (b.gaps ?? []).some((g) => g.side === side && (Math.abs(t - g.t0) < 1e-9 || Math.abs(t - g.t1) < 1e-9));
            const wall = a.wall + (c.wall - a.wall) * f;
            if (onBoundary || !bridgeParapetAt(b, t, side) || wall * BRIDGE_PARAPET_HEIGHT < 0.05) {
              end();
              continue;
            }
            const x = a.x + (c.x - a.x) * f + (a.ax + (c.ax - a.ax) * f) * side * line;
            const z = a.z + (c.z - a.z) * f + (a.az + (c.az - a.az) * f) * side * line;
            if (prev) run += Math.hypot(x - prev.x, z - prev.z);
            else run = 1e-9;
            prev = { x, z };
            standing++;
            if (near.some((o) => covers(o, x, z))) inside++;
          }
        }
        end();
      }
    }
    expect(standing).toBeGreaterThan(1000);
    expect({ inside, stubs }).toEqual({ inside: 0, stubs: 0 });
  });

  it("meets the road flush wherever a landed end's edge lies over pavement", () => {
    const road = OVERWORLD_CONFIG.cityConfig.roadWidth + 1;
    let paved = 0;
    let ledges = 0;
    for (const b of decks) {
      const s = bridgeSections(b);
      const t0 = s[0].t;
      const t1 = s[s.length - 1].t;
      for (const which of [0, 1] as const) {
        if (!b.landings?.[which]) continue;
        for (const q of s) {
          if ((which === 0 ? q.t - t0 : t1 - q.t) * b.length > 0.35 * b.length) continue;
          for (const side of [1, -1]) {
            const lat = side * (b.width / 2 - 0.3);
            const v = computeVertexDataRaw(q.x + q.ax * lat, q.z + q.az * lat);
            if (!(v.distanceToRoadCenter < road)) continue;
            paved++;
            if (q.y + q.slope * lat - v.height > 0.3) ledges++;
          }
        }
      }
    }
    // A deck that follows its own road for longer than a third of its length has no cut; the rest
    // start where their edges leave the pavement.
    expect(ledges).toBeLessThanOrEqual(Math.ceil(paved * 0.1));
  });
});
