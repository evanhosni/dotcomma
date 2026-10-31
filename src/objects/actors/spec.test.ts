import { childrenOfKind } from "../../world/content";
import { actorPlacementsOf } from "../../world/content/config";
import { DOMAIN_NODES } from "../../world/domains";
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

  it("every overworld kind spawns only in the biomes that mount it (the beeble is city-only)", () => {
    const listed = new Map<string, number[]>();
    for (const region of childrenOfKind(DOMAIN_NODES.overworld, "region")) {
      for (const biome of childrenOfKind<{ id: number }>(region, "biome")) {
        for (const { id } of actorPlacementsOf(biome)) listed.set(id, [...(listed.get(id) ?? []), biome.props.id]);
      }
    }
    expect(Object.fromEntries(listed)).toEqual({
      "beeble@sewers.rooms": [1],
      beeble: [1],
      building: [1],
      skyscraper: [1],
      house: [3],
      "beeble@caves.rooms": [7],
    });
  });
});

