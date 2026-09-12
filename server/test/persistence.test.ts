import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { PLAYER_DATA_MAX_BYTES } from "../../src/net/protocol";

/**
 * Player persistence on a throwaway SQLite file: the data layer prepares its
 * statements at import against DATABASE_PATH, so the env is set BEFORE the
 * modules load (dynamic imports below) and DB_AUTO_MIGRATE creates the schema.
 */
let dir: string;
let persistence: typeof import("../src/game/persistence.js");
let players: typeof import("../src/data/players.js");
let db: typeof import("../src/data/db.js");

describe("player persistence", () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "dotcomma-persist-"));
    process.env.DATABASE_PATH = join(dir, "test.sqlite");
    process.env.DB_AUTO_MIGRATE = "1";
    db = await import("../src/data/db.js");
    players = await import("../src/data/players.js");
    persistence = await import("../src/game/persistence.js");
  });
  after(() => {
    db.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("attach loads (creating the row), patch marks dirty, the last session out saves", () => {
    const p = new persistence.PlayerPersistence();
    const a = p.attach("id-1");
    assert.deepEqual(a.data, {});
    assert.ok(players.findPlayer("id-1"), "row created on first connect");
    p.attach("id-1"); // second tab
    assert.equal(a.sessions, 2);
    assert.deepEqual(p.patch("id-1", { volume: 0.5 }), { volume: 0.5 });
    assert.deepEqual(p.patch("id-1", { name: "x" }), { volume: 0.5, name: "x" }, "shallow merge");
    assert.equal(players.findPlayer("id-1")!.data.volume, undefined, "not written yet (never on a patch)");
    p.detach("id-1");
    assert.equal(players.findPlayer("id-1")!.data.volume, undefined, "one session still attached → no save");
    p.detach("id-1");
    assert.deepEqual(players.findPlayer("id-1")!.data, { volume: 0.5, name: "x" }, "last session out → saved");
    assert.equal(p.size, 0);
  });

  it("refuses non-object patches and blobs over the size cap", () => {
    const p = new persistence.PlayerPersistence();
    p.attach("id-2");
    assert.equal(p.patch("id-2", [1, 2]), null);
    assert.equal(p.patch("id-2", "nope"), null);
    assert.equal(p.patch("id-2", { big: "x".repeat(PLAYER_DATA_MAX_BYTES) }), null);
    assert.deepEqual(p.get("id-2")!.data, {}, "a refused patch changes nothing");
    assert.equal(p.patch("unknown", { a: 1 }), null, "unknown identity");
    p.detach("id-2");
  });

  it("flushDirty respects the interval; saveAll ignores it", () => {
    const p = new persistence.PlayerPersistence();
    const t0 = 1_000_000;
    p.attach("id-3", t0);
    p.patch("id-3", { a: 1 });
    assert.equal(p.flushDirty(t0 + 1000), 0, "too soon");
    assert.equal(p.flushDirty(t0 + persistence.SAVE_INTERVAL_MS), 1);
    assert.deepEqual(players.findPlayer("id-3")!.data, { a: 1 });
    p.patch("id-3", { b: 2 });
    assert.equal(p.saveAll(), 1);
    assert.deepEqual(players.findPlayer("id-3")!.data, { a: 1, b: 2 });
    assert.equal(p.saveAll(), 0, "nothing dirty");
    p.detach("id-3");
  });
});
