import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { ACTOR_SPECS } from "../../src/objects/actors/catalog";
import { specNeedsServer, specsAgree, type ActorSpec } from "../../src/objects/actors/spec";

/**
 * THE ACTOR CATALOG IS COMPLETE: every `src/objects/actors/<actor>/spec.ts`
 * that exports an ActorSpec the server has anything to do for (a state
 * machine, a moving body, a hull) is listed in catalog.ts under its id with
 * an agreeing spec. The client's describeActor throws for the same mismatch
 * at module load in dev; this catches it headlessly, and the failure message
 * names the line to add.
 */

const actorsDir = resolve(dirname(new URL(import.meta.url).pathname), "../../src/objects/actors");

const isActorSpec = (v: unknown): v is ActorSpec =>
  typeof v === "object" && v !== null && typeof (v as ActorSpec).id === "string" && specNeedsServer(v as ActorSpec);

describe("actor catalog", () => {
  it("lists every spec.ts the server must know about, with the same simulation", async () => {
    const found: ActorSpec[] = [];
    for (const dir of readdirSync(actorsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const specPath = resolve(actorsDir, dir.name, "spec.ts");
      if (!existsSync(specPath)) continue;
      const mod = (await import(pathToFileURL(specPath).href)) as Record<string, unknown>;
      for (const v of Object.values(mod)) if (isActorSpec(v)) found.push(v);
    }
    assert.ok(found.length >= 2, `found ${found.length} actor specs under src/objects/actors/*/spec.ts`);
    for (const spec of found) {
      const listed = ACTOR_SPECS[spec.id];
      assert.ok(listed, `actor "${spec.id}" has a spec but no catalog entry — add \`[${spec.id}]: <spec>\` to src/objects/actors/catalog.ts`);
      assert.ok(specsAgree(listed, spec), `catalog entry for "${spec.id}" differs from its spec.ts`);
    }
    for (const id of Object.keys(ACTOR_SPECS)) assert.ok(found.some((s) => s.id === id), `catalog lists "${id}" but no spec.ts exports it`);
  });

  it("every catalog spec is Three-free data the server can run", () => {
    for (const [id, spec] of Object.entries(ACTOR_SPECS)) {
      assert.equal(spec.id, id, "keyed by its own id");
      if (spec.stateMachine) {
        assert.ok(spec.stateMachine.states.length > 0, `${id}: has states`);
        assert.ok(spec.stateMachine.states.some((s) => s.id === spec.stateMachine!.initialState), `${id}: initial state exists`);
      }
      if (spec.body === "kinematic") assert.ok(spec.stateMachine, `${id}: a moving body needs a state machine to move it`);
    }
  });
});
