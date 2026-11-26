import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { ServerMessage } from "../../src/net/protocol/types";

// The data layer prepares statements at import against DATABASE_PATH, so the env is set BEFORE the
// dynamic imports below.
let dir: string;
let worldModule: typeof import("../src/game/world.js");
let db: typeof import("../src/data/index.js");

/** A world with no physics, its outbox recorded. */
const makeWorld = () => {
  const sent: { to: string; msg: ServerMessage }[] = [];
  const out = {
    send: (to: string, msg: ServerMessage) => void sent.push({ to, msg }),
    sendMany: (ids: Iterable<string>, msg: ServerMessage, except?: string) => {
      for (const to of ids) if (to !== except) sent.push({ to, msg });
    },
  };
  const world = new worldModule.World(out);
  const to = (who: string, t: ServerMessage["t"]) => sent.filter((s) => s.to === who && s.msg.t === t).map((s) => s.msg as any);
  return { world, sent, to };
};

const HOST = "100_200_beeble";

/** The intro's possession (world/domains/overworld/intro/): one claim per host, and a possessed NPC is gone
 *  for everyone in the domain, newcomers included. */
describe("hosts", () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "dotcomma-hosts-"));
    process.env.DATABASE_PATH = join(dir, "test.sqlite");
    process.env.DB_AUTO_MIGRATE = "1";
    db = await import("../src/data/index.js");
    worldModule = await import("../src/game/world.js");
  });
  after(() => {
    db.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a host is one player's claim at a time; leaving frees it", () => {
    const { world, to } = makeWorld();
    world.addSession("A", "identity-a", "overworld");
    world.addSession("B", "identity-b", "overworld");
    world.host("A", HOST, "claim");
    world.host("B", HOST, "claim");
    assert.deepEqual(to("A", "host:claim"), [{ t: "host:claim", id: HOST, ok: true }]);
    assert.deepEqual(to("B", "host:claim"), [{ t: "host:claim", id: HOST, ok: false }]);
    world.removeSession("A");
    world.host("B", HOST, "claim");
    assert.deepEqual(to("B", "host:claim").at(-1), { t: "host:claim", id: HOST, ok: true });
  });

  it("a step with no claim on record claims the host (a server restart lost the claim)", () => {
    const { world, to } = makeWorld();
    world.addSession("A", "identity-a", "overworld");
    world.addSession("B", "identity-b", "overworld");
    world.host("A", HOST, "impact");
    world.host("B", HOST, "claim");
    assert.deepEqual(to("B", "host:claim"), [{ t: "host:claim", id: HOST, ok: false }]);
  });

  it("possessing takes the host for good: everyone is told, newcomers get the list, nobody can claim it", () => {
    const { world, to } = makeWorld();
    world.addSession("A", "identity-a", "overworld");
    world.addSession("B", "identity-b", "overworld");
    world.host("A", HOST, "claim");
    world.host("B", HOST, "possess");
    assert.equal(to("A", "host:taken").length, 0, "only the claimer's steps count");
    world.host("A", HOST, "possess");
    assert.deepEqual(to("A", "host:taken"), [{ t: "host:taken", id: HOST }]);
    assert.deepEqual(to("B", "host:taken"), [{ t: "host:taken", id: HOST }]);
    world.addSession("C", "identity-c", "overworld");
    assert.deepEqual(to("C", "init")[0].hostsTaken, [HOST]);
    world.host("C", HOST, "claim");
    assert.deepEqual(to("C", "host:claim"), [{ t: "host:claim", id: HOST, ok: false }]);
  });
});
