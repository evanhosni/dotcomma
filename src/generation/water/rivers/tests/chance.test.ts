/** <Rivers chance> on a biome: it overrides its region's keep roll, and chance 0 makes the biome DRY —
 *  no river runs in it: a stretch reaching it ends at its wall (a pond where its <Pond riverEnd> rolls,
 *  else round), unless the river is built again past it, close enough for a gorge (generation/water/rivers/gaps/index.ts
 *  gorgeCut), when it is carved through like a ridge. */
import { DOMAIN_CONFIGS } from "../../../../world/domains";
import { biomeIdOf } from "../../../../world/content/config";
import type { DomainConfig } from "../../../types";
import { initCompute } from "../../..";
import { zoneAtWarped } from "../../../zones";
import { PIECE_DRY, PIECE_GORGE } from "../enums";
import { finalEdge, riverPiecesNear, stretchesOf } from "../network";
import { gorgedCodes } from "../gaps";
import { junctionEndKind } from "../road-layer";
import type { RiverEdge } from "../types";

const OVERWORLD = DOMAIN_CONFIGS.overworld;
const GRASS = biomeIdOf(OVERWORLD, "grass");

/** The overworld with grass mounting its own <Rivers chance>. */
const withGrassRivers = (chance: number): DomainConfig => ({
  ...OVERWORLD,
  regions: OVERWORLD.regions.map((r) => ({
    ...r,
    biomes: r.biomes.map((b) => (b.id === GRASS ? { ...b, features: { ...b.features, rivers: { chance } } } : b)),
  })),
});

const edgesIn = (r: number): RiverEdge[] => [...new Map(riverPiecesNear(-r, -r, r, r, 0).map((p) => [p.edge.key, p.edge])).values()];

describe("<Rivers chance> on a biome", () => {
  afterAll(() => initCompute(OVERWORLD));

  it("chance 0 builds no piece in the biome but a crossing's gorge, and ends every other stretch at its wall", () => {
    initCompute(withGrassRivers(0));
    let dry = 0;
    let crossed = 0;
    let ends = 0;
    for (const e of edgesIn(8000)) {
      const L = e.len / e.count;
      const codes = gorgedCodes(e);
      const pieces = finalEdge(e);
      for (let i = 0; i < e.count; i++) {
        const mid = zoneAtWarped(e.ax + e.ux * (i + 0.5) * L, e.az + e.uz * (i + 0.5) * L);
        if (mid.biome.id !== GRASS) continue;
        dry++;
        if (codes[i] === PIECE_GORGE) {
          crossed++;
          continue;
        }
        expect(codes[i]).toBe(PIECE_DRY);
        expect(pieces[i]).toBeNull();
      }
      // A built piece beside a dry one ends its stretch there like any natural end: round, or a pond where
      // its <Pond riverEnd> rolls — a disc (generation/water/rivers/ponds/index.ts) unless a road runs within its reach.
      const endKinds = new Map(stretchesOf(e, e.codes!, (j) => junctionEndKind(e, j)).flat().map((end) => [end.joint, end.kind]));
      for (let i = 0; i < e.count; i++) {
        if (!pieces[i]) continue;
        for (const [n, k] of [[i - 1, i], [i + 1, i + 1]]) {
          if (n < 0 || n >= e.count || codes[n] !== PIECE_DRY) continue;
          ends++;
          expect(["pond", "round"]).toContain(endKinds.get(k));
          if (endKinds.get(k) === "pond" && !e.ponds!.some((p) => p.joint === k)) expect(e.roads?.length).toBeGreaterThan(0);
        }
      }
    }
    expect(dry).toBeGreaterThan(0);
    expect(crossed).toBeLessThan(dry / 3);
    expect(ends).toBeGreaterThan(0);
  });

  it("a chance mounted on a biome decides the keep roll of the edges whose midpoint lies in it", () => {
    const inGrass = (chance: number): number => {
      initCompute(withGrassRivers(chance));
      return edgesIn(12000).filter((e) => zoneAtWarped((e.a.x + e.b.x) / 2, (e.a.z + e.b.z) / 2).biome.id === GRASS).length;
    };
    expect(inGrass(0)).toBe(0);
    // Above the city region's 0.61: more grass edges kept than the region alone keeps.
    initCompute(OVERWORLD);
    const regional = edgesIn(12000).filter((e) => zoneAtWarped((e.a.x + e.b.x) / 2, (e.a.z + e.b.z) / 2).biome.id === GRASS).length;
    expect(inGrass(1)).toBeGreaterThan(regional);
  });

  it("a river crossing a dry biome between two built stretches is carved through it (Evan, Nov 2026)", () => {
    initCompute(OVERWORLD);
    // Edge -1,-3~0,-3 crosses an oasis cell at (647, -4756) over 547u (gorge rise 28u): it ended in two
    // ponds facing each other across the oasis's dunes.
    const e = edgesIn(6000).find((f) => f.key === "-1,-3~0,-3")!;
    const codes = gorgedCodes(e);
    const pieces = finalEdge(e);
    const L = e.len / e.count;
    let oasis = 0;
    for (let i = 0; i < e.count; i++) {
      if (zoneAtWarped(e.ax + e.ux * (i + 0.5) * L, e.az + e.uz * (i + 0.5) * L).biome.name !== "oasis") continue;
      oasis++;
      expect(codes[i]).toBe(PIECE_GORGE);
      expect(pieces[i]).not.toBeNull();
    }
    expect(oasis).toBeGreaterThan(8);
  });
});
