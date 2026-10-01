import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { specNeedsServer, type ActorSpec } from "../../src/objects/actors/spec";
import { ACTOR_CATALOG, DOMAIN_REGIONS } from "../../src/world/domains/configs";

/**
 * THE ACTOR CATALOG is derived from the domains' biome specs (src/world/domains/configs.ts): every
 * kind a biome places that the server simulates (a state machine, a moving body, a hull). These
 * tests check the derivation headlessly and that every such kind is data the server can run.
 */

const actorsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/objects/actors");

const isActorSpec = (v: unknown): v is ActorSpec => typeof v === "object" && v !== null && typeof (v as ActorSpec).id === "string";

describe("actor catalog", () => {
  it("is every server-simulated kind the domains place, keyed by its id", () => {
    const placed = new Set<ActorSpec>();
    for (const regions of Object.values(DOMAIN_REGIONS)) {
      for (const r of regions) for (const b of r.biomes) for (const m of b.actors ?? []) if (specNeedsServer(m.actor)) placed.add(m.actor);
    }
    assert.ok(placed.size >= 2, `found ${placed.size} placed server-simulated kinds`);
    assert.deepEqual(new Set(Object.values(ACTOR_CATALOG)), placed);
    for (const [id, spec] of Object.entries(ACTOR_CATALOG)) assert.equal(spec.id, id, "keyed by its own id");
  });

  it("no two exported actor specs share an id (a spread variant must set its own)", async () => {
    const byId = new Map<string, ActorSpec>();
    for (const dir of readdirSync(actorsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const specPath = resolve(actorsDir, dir.name, "spec.ts");
      if (!existsSync(specPath)) continue;
      const mod = (await import(pathToFileURL(specPath).href)) as Record<string, unknown>;
      for (const v of Object.values(mod)) {
        if (!isActorSpec(v)) continue;
        const other = byId.get(v.id);
        assert.ok(!other || other === v, `two specs under src/objects/actors/*/spec.ts share the id "${v.id}"`);
        byId.set(v.id, v);
      }
    }
    assert.ok(byId.size >= 2, `found ${byId.size} actor specs under src/objects/actors/*/spec.ts`);
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
