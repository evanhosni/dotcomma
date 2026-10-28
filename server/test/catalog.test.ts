import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { specNeedsServer, type ActorSpec } from "../../src/objects/actors/spec";
import { ACTOR_CATALOG, DOMAIN_NODES } from "../../src/world/domains";
import { childrenOfKind } from "../../src/world/content";
import { actorPlacementsOf } from "../../src/world/content/config";

/**
 * THE ACTOR CATALOG is derived from the <Actor> components the worlds' biomes mount
 * (src/world/domains/): every kind a biome places that the server simulates (a state machine, a moving body, a hull). These
 * tests check the derivation headlessly and that every such kind is data the server can run.
 */



describe("actor catalog", () => {
  it("is every server-simulated kind the worlds mount, keyed by its id (and a feature-placed one by its own id too)", () => {
    const placed = new Set<ActorSpec>();
    const ids = new Map<string, ActorSpec>();
    for (const domain of Object.values(DOMAIN_NODES)) {
      for (const region of childrenOfKind(domain, "region")) {
        for (const biome of childrenOfKind(region, "biome")) {
          for (const { id, mount } of actorPlacementsOf(biome)) {
            if (!specNeedsServer(mount.actor)) continue;
            placed.add(mount.actor);
            ids.set(mount.actor.id, mount.actor).set(id, mount.actor);
          }
        }
      }
    }
    assert.ok(placed.size >= 2, `found ${placed.size} placed server-simulated kinds`);
    assert.deepEqual(new Set(Object.values(ACTOR_CATALOG)), placed);
    assert.deepEqual(new Map(Object.entries(ACTOR_CATALOG)), ids);
  });

  it("every catalog spec is Three-free data the server can run", () => {
    for (const [id, spec] of Object.entries(ACTOR_CATALOG)) {
      if (spec.stateMachine) {
        assert.ok(spec.stateMachine.states.length > 0, `${id}: has states`);
        assert.ok(spec.stateMachine.states.some((s) => s.id === spec.stateMachine!.initialState), `${id}: initial state exists`);
      }
      if (spec.body === "kinematic") assert.ok(spec.stateMachine, `${id}: a moving body needs a state machine to move it`);
      if ((spec.component ?? "model") === "model") assert.ok(spec.model, `${id}: renders as a GLTF model, so its spec needs \`model\``);
    }
  });
});
