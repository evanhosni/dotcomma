/** A sliver slab triangle has no plane (generation/bridges/deck/drawn-slab/index.ts SLAB_SLIVER): the ground beside a Y deck's crotch
 *  flare, where one section's corner lands on the previous one's cross line, rested on the plane of a
 *  zero-width quad carried on past the slab and went down to −1e11 (a hexagonal well in the river beside
 *  the deck at 18198, −2946, and four more such decks within 16 km of it). */
import { DOMAIN_CONFIGS } from "../../../../../world/domains";
import { BRIDGE_PLACEMENT } from "../../../../../objects/dressing/bridges/spec";
import { drawnOf } from "..";
import { type FreewayBridge, computeVertexData, getFreewayBridges, initCompute, setDeckCutSpacing } from "../../../..";

const LOD1 = 420 / 96;
const LOD2 = 420 / 24;

const decksAt = (x: number, z: number): FreewayBridge[] =>
  getFreewayBridges(x - 256, z - 256, x + 256, z + 256, BRIDGE_PLACEMENT).filter((b) => {
    const { box } = drawnOf(b);
    return x >= box[0] - 16 && x <= box[2] + 16 && z >= box[1] - 16 && z <= box[3] + 16;
  });

describe("the ground beside a deck's drawn slab", () => {
  beforeAll(() => initCompute(DOMAIN_CONFIGS.overworld));
  afterAll(() => setDeckCutSpacing(LOD1));

  it("lies with its neighbours in the river at the reported spot (18198, −2946)", () => {
    const h = computeVertexData(18195.625, -2966.25).height;
    for (const [dx, dz] of [[-LOD1, 0], [LOD1, 0], [0, -LOD1], [0, LOD1]]) {
      expect(Math.abs(h - computeVertexData(18195.625 + dx, -2966.25 + dz).height)).toBeLessThan(5);
    }
  });

  // Every deck with a sliver the 32 km census found a runaway beside (18198, −2946 is the report).
  it.each([
    [18198, -2960],
    [23399, -4300],
    [17576, -14970],
    [8170, -17942],
  ])("never falls far under the slab, on the LOD1 or the LOD2 lattice (deck at %d, %d)", (cx, cz) => {
    const decks = decksAt(cx, cz);
    expect(decks.length).toBeGreaterThan(0);
    for (const sp of [LOD1, LOD2]) {
      setDeckCutSpacing(sp);
      for (const b of decks) {
        const { box, S } = drawnOf(b);
        const lowest = Math.min(...S.map((s) => s.y));
        const reach = sp * Math.SQRT2 + 8;
        for (let ix = Math.floor((box[0] - reach) / sp); ix <= Math.ceil((box[2] + reach) / sp); ix++) {
          for (let iz = Math.floor((box[1] - reach) / sp); iz <= Math.ceil((box[3] + reach) / sp); iz++) {
            const h = computeVertexData(ix * sp, iz * sp).height;
            if (!(h > lowest - 150)) throw new Error(`ground at (${ix * sp}, ${iz * sp}) lattice ${sp}: ${h} under a slab whose lowest section is ${lowest}`);
          }
        }
      }
    }
    setDeckCutSpacing(LOD1);
  });
});
