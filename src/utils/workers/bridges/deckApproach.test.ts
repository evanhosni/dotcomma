/** A road is flat across its width where a deck lands on it (CLAUDE.md, bridges): a landed end's
 *  APPROACH carries the road at its own grade, the river's bank giving way to it — not the road to the
 *  bank, which crossed a road met obliquely by a river diagonally and left the deck sitting on a bowed
 *  road (a 9u bow at (-258, 3115), pits and mounds in front of the cut, a trench under a ramp). And a
 *  river under a crossing freeway eases down to it along its length instead of dropping within one
 *  piece (36u at (-1548, 1090), a gorge under the deck). */
import { OVERWORLD_CONFIG } from "../../../world/domains/overworld/config";
import { BRIDGE_PLACEMENT } from "../../../objects/dressing/bridges/bridgeSpec";
import { riverPieceEndSurface, riverPieceEndTerrainSurface } from "../rivers/riverField";
import { riverPiecesIn } from "../rivers/riverNetwork";
import { type FreewayBridge, bridgeSections, computeVertexData, computeVertexDataRaw, getFreewayBridges, initCompute } from "../vertexCompute";

const CHUNK = 256;
const decksNear = (cx: number, cz: number, r: number): FreewayBridge[] => {
  const out = new Map<string, FreewayBridge>();
  for (let gx = Math.floor(cx / CHUNK) - r; gx <= Math.floor(cx / CHUNK) + r; gx++) {
    for (let gz = Math.floor(cz / CHUNK) - r; gz <= Math.floor(cz / CHUNK) + r; gz++) {
      for (const b of getFreewayBridges(gx * CHUNK, gz * CHUNK, (gx + 1) * CHUNK, (gz + 1) * CHUNK, BRIDGE_PLACEMENT)) out.set(`${b.x},${b.z}`, b);
    }
  }
  return [...out.values()];
};

describe("a deck landing's approach", () => {
  beforeAll(() => initCompute(OVERWORLD_CONFIG));

  it("is flat across the road at its own grade, wherever the river meets the road", () => {
    // The famous-meadow run's two decks (both cut ends bowed 1–9u; a ramp end over a falling shoulder)
    // and a run crossing a river obliquely.
    const decks = [...decksNear(-187, 3192, 1), ...decksNear(5666, 1474, 1)];
    let ends = 0;
    for (const b of decks) {
      const S = bridgeSections(b);
      for (const which of [0, 1] as const) {
        if (!b.landings?.[which]) continue;
        ends++;
        const e = which === 0 ? S[0] : S[S.length - 1];
        const q = which === 0 ? S[1] : S[S.length - 2];
        const dl = Math.hypot(q.x - e.x, q.z - e.z);
        const dx = (q.x - e.x) / dl;
        const dz = (q.z - e.z) / dl;
        // Across the asphalt, square to the deck, from the end out over the approach: the surface the
        // landing sits on deviates from a straight line by the road's own camber at most.
        for (let d = 0; d <= 20; d += 4) {
          const at = (l: number) => computeVertexDataRaw(e.x - dx * d - dz * l, e.z - dz * d + dx * l).approachHeight;
          const lo = at(-10);
          const hi = at(10);
          for (const l of [-5, 0, 5]) expect(Math.abs(at(l) - (lo + ((hi - lo) * (l + 10)) / 20))).toBeLessThan(0.35);
        }
      }
    }
    expect(ends).toBeGreaterThanOrEqual(6);
  });

  it("draws no water over the ground in front of a landed end or under its start", () => {
    for (const b of [...decksNear(-187, 3192, 1), ...decksNear(5666, 1474, 1), ...decksNear(-1542, 1069, 1)]) {
      const S = bridgeSections(b);
      for (const which of [0, 1] as const) {
        if (!b.landings?.[which]) continue;
        const e = which === 0 ? S[0] : S[S.length - 1];
        const q = which === 0 ? S[1] : S[S.length - 2];
        const dl = Math.hypot(q.x - e.x, q.z - e.z);
        for (let d = -15; d <= 40; d += 5) {
          for (let l = -20; l <= 20; l += 5) {
            const v = computeVertexData(e.x - ((q.x - e.x) / dl) * d - ((q.z - e.z) / dl) * l, e.z - ((q.z - e.z) / dl) * d + ((q.x - e.x) / dl) * l);
            if (!Number.isNaN(v.waterHeight)) expect(v.waterHeight).toBeLessThanOrEqual(v.height + 0.05);
          }
        }
      }
    }
  });
});

describe("a river under a crossing freeway", () => {
  beforeAll(() => initCompute(OVERWORLD_CONFIG));

  it("eases down to the crossing's cap: no piece drops more than RIVER_CAP_GRADE's 6u beyond the terrain's own fall", () => {
    let capped = 0;
    const seen = new Set<string>();
    for (let z = -4000; z < 4000; z += 500) {
      for (let x = -4000; x < 4000; x += 500) {
        for (const p of riverPiecesIn({ x: x + 250, z: z + 250 }, x, z, x + 500, z + 500, 0)) {
          const key = `${p.edge.key}:${p.index}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = riverPieceEndSurface(p, 0);
          const b = riverPieceEndSurface(p, 1);
          const ta = riverPieceEndTerrainSurface(p, 0);
          const tb = riverPieceEndTerrainSurface(p, 1);
          if (!(a < ta - 0.01 || b < tb - 0.01)) continue;
          capped++;
          expect(Math.abs(a - b) - Math.abs(ta - tb)).toBeLessThanOrEqual(6 + 1e-6);
        }
      }
    }
    expect(capped).toBeGreaterThan(10);
  });

  it("stands no lower than 5u under the belt it passes beside the city at (-1551, 1084)", () => {
    // Its landing on one side was sampled straight on past a belt corner, off the road, 36u under it.
    const v = computeVertexDataRaw(-1545, 1104);
    expect(v.waterHeight).toBeGreaterThan(10);
  });
});
