import { OVERWORLD_REGIONS } from "../../world/domains/overworld/regions";
import { mergeActorListings } from "./spec";

describe("biome listings are an actor's biomes", () => {
  it("a kind listed by several biomes spawns in their union, other attributes from its last listing", () => {
    const merged = mergeActorListings([
      { id: "frog", biomeIds: [2], density: 10 },
      { id: "rock", biomeIds: [2] },
      { id: "frog", biomeIds: [5], density: 40 },
      { id: "frog", biomeIds: [2], density: 20 },
    ]);
    expect(merged).toEqual([
      { id: "frog", biomeIds: [2, 5], density: 20 },
      { id: "rock", biomeIds: [2] },
    ]);
  });

  it("every overworld kind spawns only in the biomes that list it (the beeble is city-only)", () => {
    const listed = new Map<string, number[]>();
    for (const r of OVERWORLD_REGIONS) {
      for (const b of r.biomes) for (const m of b.actors ?? []) listed.set(m.actor.id, [...(listed.get(m.actor.id) ?? []), b.id]);
    }
    expect(Object.fromEntries(listed)).toEqual({
      beeble: [1],
      building: [1],
      skyscraper: [1],
      "grass-building": [3],
    });
  });
});
