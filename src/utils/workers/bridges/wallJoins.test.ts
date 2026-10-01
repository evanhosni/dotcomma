/** Wall joins at deck merges (wallJoins.ts), on the real compute module with the overworld's config:
 *  where two merged decks' walls end at one corner, each runs on until it meets the other's wall, so no
 *  notch is left between them; the run-on stands only over the merged slabs, never over pavement; its
 *  colliders are what the ribbon draws; and it is the same whatever order the chunks are asked in. */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PARAPET_HEIGHT, BRIDGE_PLACEMENT, bridgeColliderPoints } from "../../../objects/dressing/bridges/bridgeSpec";
import { drawnOn } from "./drawnSlab";
import { pavedAt } from "./landings";
import { type FreewayBridge, bridgeSections, getFreewayBridges, initCompute } from "../vertexCompute";
import { BRIDGE_WALL_PARTNER_REACH, type BridgeWallEnd, bridgeWallEnds, bridgeWallFootprints } from "./wallJoins";

const CHUNK = 256;
/** A corner whose partner's wall is open over road pavement there (nothing to meet) leaves a gap of
 *  several units; the corners a join closes measured 0.05–3u before it. */
const OPEN_PARTNER = 5;
const TOUCH = 0.05;

initCompute(OVERWORLD_CONFIG);

const chunksNear = (cx: number, cz: number, r: number): [number, number][] => {
  const out: [number, number][] = [];
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) out.push([gx, gz]);
  return out;
};
const decksOf = (chunks: [number, number][]): FreewayBridge[] => chunks.flatMap(([gx, gz]) => getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT));

const inQuad = (q: number[], x: number, z: number): boolean => {
  let sign = 0;
  for (let k = 0; k < q.length / 2; k++) {
    const [ax, az, cx, cz] = [q[2 * k], q[2 * k + 1], q[(2 * k + 2) % q.length], q[(2 * k + 3) % q.length]];
    const s = Math.sign((cx - ax) * (z - az) - (cz - az) * (x - ax));
    if (s === 0) continue;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
};
const segmentDistance = (x: number, z: number, ax: number, az: number, cx: number, cz: number): number => {
  const u = Math.max(0, Math.min(1, ((x - ax) * (cx - ax) + (z - az) * (cz - az)) / ((cx - ax) ** 2 + (cz - az) ** 2 || 1)));
  return Math.hypot(x - ax - (cx - ax) * u, z - az - (cz - az) * u);
};
const distanceTo = (quads: number[][], x: number, z: number): number => {
  let d = Infinity;
  for (const q of quads) {
    if (inQuad(q, x, z)) return 0;
    for (let k = 0; k < q.length / 2; k++) d = Math.min(d, segmentDistance(x, z, q[2 * k], q[2 * k + 1], q[(2 * k + 2) % q.length], q[(2 * k + 3) % q.length]));
  }
  return d;
};
/** Every wall a deck draws, as x/z quads: its standing chords and its joins' legs. */
const wallsOf = (b: FreewayBridge): number[][] => {
  const out = bridgeWallFootprints(b);
  for (const j of b.wallJoins ?? []) {
    const a = j.at;
    for (let o = 0; o + 12 <= a.length; o += 6) out.push([a[o], a[o + 2], a[o + 6], a[o + 8], a[o + 9], a[o + 11], a[o + 3], a[o + 5]]);
  }
  return out;
};

describe("bridge wall joins at merges", () => {
  // Y merges, T merges with crotch fillets, a fillet tip beside a curving host, near-square corners.
  const chunks = [...chunksNear(3785, 10901, 1), ...chunksNear(3600, 1520, 1), ...chunksNear(1600, -7850, 1), ...chunksNear(-15835, 10076, 1), ...chunksNear(-8030, -13490, 1)];
  const decks = decksOf(chunks);

  it("closes every merge corner: each wall end meets its partner's wall", () => {
    const walls = new Map(decks.map((b) => [b, wallsOf(b)]));
    let corners = 0;
    for (const b of decks) {
      for (const e of bridgeWallEnds(b)) {
        let partner: FreewayBridge | null = null;
        let mate: BridgeWallEnd | null = null;
        let best = BRIDGE_WALL_PARTNER_REACH;
        for (const o of decks) {
          if (o === b) continue;
          for (const f of bridgeWallEnds(o)) {
            const d = Math.hypot(f.ox - e.ox, f.oz - e.oz);
            if (d <= best) {
              best = d;
              partner = o;
              mate = f;
            }
          }
        }
        if (!partner || !mate) continue;
        // The end as drawn: the wall's own, or its join's last corners.
        const j = (b.wallJoins ?? []).find((q) => q.at[0] === e.ox && q.at[2] === e.oz);
        const [ox, oz, ix, iz] = j ? [j.at[j.at.length - 6], j.at[j.at.length - 4], j.at[j.at.length - 3], j.at[j.at.length - 1]] : [e.ox, e.oz, e.ix, e.iz];
        // The inner corner short of the partner's wall is the notch; past its inner face it is a tip (a wall
        // overshooting into the other's roadway, which a run-on cannot take back). Near one line: either corner.
        const collinear = -(e.dx * mate.dx + e.dz * mate.dz) > Math.cos((25 * Math.PI) / 180);
        let nx = -mate.dz;
        let nz = mate.dx;
        if (nx * (mate.ix - mate.ox) + nz * (mate.iz - mate.oz) < 0) [nx, nz] = [-nx, -nz];
        const past = (ix - mate.ix) * nx + (iz - mate.iz) * nz > 0;
        const P = walls.get(partner)!;
        const gap = collinear ? Math.min(distanceTo(P, ix, iz), distanceTo(P, ox, oz)) : past ? 0 : distanceTo(P, ix, iz);
        if (gap > OPEN_PARTNER) continue;
        corners++;
        expect(gap).toBeLessThanOrEqual(TOUCH);
      }
    }
    expect(corners).toBeGreaterThanOrEqual(15);
    expect(decks.reduce((n, b) => n + (b.wallJoins?.length ?? 0), 0)).toBeGreaterThanOrEqual(8);
  });

  it("runs on only over the merged slabs and never over road pavement", () => {
    for (const b of decks) {
      const near = decks.filter((o) => Math.hypot(o.x - b.x, o.z - b.z) < o.length / 2 + b.length / 2 + 50);
      for (const j of b.wallJoins ?? []) {
        const a = j.at;
        for (let o = 0; o + 12 <= a.length; o += 6) {
          for (const f of [0.25, 0.5, 0.75]) {
            // The leg's middle line (its faces lie on slab edges and partners' walls).
            const x = (a[o] + a[o + 3]) / 2 + ((a[o + 6] + a[o + 9]) / 2 - (a[o] + a[o + 3]) / 2) * f;
            const z = (a[o + 2] + a[o + 5]) / 2 + ((a[o + 8] + a[o + 11]) / 2 - (a[o + 2] + a[o + 5]) / 2) * f;
            expect(near.some((d) => drawnOn(d, x, z))).toBe(true);
            expect(pavedAt(x, z)).toBe(false);
          }
        }
      }
    }
  });

  it("gives every join one closed collider body standing the wall's height over the slab", () => {
    for (const b of decks) {
      const joins = b.wallJoins ?? [];
      if (joins.length === 0) continue;
      const bodies = bridgeColliderPoints(b).slice(bridgeSections(b).length - 1);
      expect(bodies.length).toBe(joins.length);
      bodies.forEach((p, k) => {
        const v = p.mesh.vertices;
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 1; i < v.length; i += 3) {
          lo = Math.min(lo, v[i] + p.y);
          hi = Math.max(hi, v[i] + p.y);
        }
        const slab = Math.min(...joins[k].at.filter((_, i) => i % 3 === 1));
        expect(lo).toBeLessThan(slab);
        expect(hi).toBeGreaterThan(slab + BRIDGE_PARAPET_HEIGHT * joins[k].wall * 0.9);
        expect(p.mesh.indices.length % 36).toBe(0);
      });
    }
  });

  it("is the same whatever order the chunks are asked in", () => {
    const key = (ds: FreewayBridge[]) =>
      ds
        .flatMap((b) => (b.wallJoins ?? []).map((j) => `${b.x.toFixed(3)},${b.z.toFixed(3)}:${j.side}:${j.at.map((v) => v.toFixed(5)).join(",")}`))
        .sort()
        .join("\n");
    expect(key(decksOf([...chunks].reverse()))).toBe(key(decks));
  });
});
