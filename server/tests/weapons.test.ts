import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { MoveIntent, ServerMessage, ShootMessage, ShotHit, Wound } from "../../src/net/protocol/types";
import { PLAYER_HEALTH } from "../../src/player/spec";
import { REVOLVER_SPEC } from "../../src/weapons/spec";
import { CORPSE_SECONDS } from "../../src/objects/actors/wounds/constants";

// The data layer prepares statements at import against DATABASE_PATH, so the env is set BEFORE the
// dynamic imports below.
let dir: string;
let worldModule: typeof import("../src/game/world.js");
let db: typeof import("../src/data/index.js");

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
  return { world, to };
};

const standing = (x: number, wp = REVOLVER_SPEC.id): MoveIntent => ({
  x, y: 1, z: 0, vx: 0, vy: 0, vz: 0, ry: 0, hy: 0, hp: 0, clip: "idle", cs: 1, loop: "repeat", fm: "host", mh: "", md: 0, wp,
});
const HOLE = { b: ["body"], w: [1], x: 0, y: 1.2, z: -0.4, nx: 0, ny: 0, nz: -1, r: REVOLVER_SPEC.woundRadius };
const WOUND: Wound = { entry: HOLE, exit: { ...HOLE, z: 0.4, nz: 1 } };
const HIT_B: ShotHit = { kind: "player", id: "B", at: [9.6, 1.2, 0], wounds: [WOUND] };
/** A shot from A (at x 0) at B (at x 10), stopped by a wall behind it. */
const shotAtB = (): ShootMessage => ({ t: "shoot", weapon: REVOLVER_SPEC.id, o: [0, 2, 0], d: [1, 0, 0], hits: [HIT_B], end: { at: [30, 2, 0], n: [-1, 0, 0] } });
const SHOTS_TO_KILL = Math.ceil(PLAYER_HEALTH / REVOLVER_SPEC.damage);
const GAP_MS = REVOLVER_SPEC.fireInterval * 1000;

/** Two armed hosts, A and B, ten apart. */
const duel = () => {
  const w = makeWorld();
  w.world.addSession("A", "identity-a", "overworld");
  w.world.addSession("B", "identity-b", "overworld");
  w.world.move("A", standing(0));
  w.world.move("B", standing(10));
  return w;
};

/** Shooting (weapons/): the server applies a hit only from an armed live host, at its weapon's rate and
 *  reach; a player loses health per hit, keeps its wounds, and dies at 0 for everyone to see. */
describe("weapons", () => {
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "dotcomma-weapons-"));
    process.env.DATABASE_PATH = join(dir, "test.sqlite");
    process.env.DB_AUTO_MIGRATE = "1";
    db = await import("../src/data/index.js");
    worldModule = await import("../src/game/world.js");
  });
  after(() => {
    db.closeDb();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a hit hurts its target, everyone sees the shot but the shooter, and the wounds are kept", () => {
    const { world, to } = duel();
    world.shoot("A", shotAtB(), 1000);
    assert.deepEqual(to("B", "player:hurt"), [{ t: "player:hurt", id: "B", health: PLAYER_HEALTH - REVOLVER_SPEC.damage, wounds: [WOUND] }]);
    assert.equal(to("B", "shot").length, 1);
    assert.equal(to("A", "shot").length, 0, "the shooter drew its own");
    assert.deepEqual(to("B", "shot")[0].hits, [HIT_B]);
    assert.deepEqual(to("B", "shot")[0].end, { at: [30, 2, 0], n: [-1, 0, 0] }, "the bullet hole where it stopped");
  });

  it("a bullet goes through every body on its way, each once", () => {
    const { world, to } = duel();
    world.addSession("C", "identity-c", "overworld");
    world.move("C", standing(20));
    const hitC: ShotHit = { ...HIT_B, id: "C", at: [19.6, 1.2, 0] };
    world.shoot("A", { ...shotAtB(), hits: [HIT_B, hitC, HIT_B] }, 1000);
    assert.equal(to("B", "player:hurt").filter((m) => m.id === "B").length, 1, "B once");
    assert.equal(to("B", "player:hurt").filter((m) => m.id === "C").length, 1, "and C behind it");
    assert.deepEqual(to("C", "shot")[0].hits, [HIT_B, hitC]);
  });

  it("a dead player's corpse takes holes: shots at it reach everyone, while it lies", () => {
    const { world, to } = duel();
    for (let i = 0; i < SHOTS_TO_KILL; i++) world.shoot("A", shotAtB(), 1000 + i * GAP_MS);
    const corpse = to("A", "player:died")[0].corpse as string;
    assert.ok(corpse);
    const atCorpse = (now: number, id = corpse) => world.shoot("A", { ...shotAtB(), hits: [{ ...HIT_B, kind: "corpse", id }] }, now);
    atCorpse(5000);
    assert.equal(to("B", "shot").at(-1).hits.length, 1);
    atCorpse(6000, "B~999");
    assert.equal(to("B", "shot").at(-1).hits.length, 0, "no such corpse");
    atCorpse(1000 + CORPSE_SECONDS * 1000 + 1);
    assert.equal(to("B", "shot").at(-1).hits.length, 0, "gone");
  });

  it("enough hits kill: everyone is told, and a dead host takes no more", () => {
    const { world, to } = duel();
    for (let i = 0; i < SHOTS_TO_KILL; i++) world.shoot("A", shotAtB(), 1000 + i * GAP_MS);
    assert.deepEqual(to("A", "player:died"), [{ t: "player:died", id: "B", d: [1, 0, 0], corpse: "B~1" }]);
    assert.equal(to("B", "player:hurt").at(-1).health, 0);
    world.shoot("A", shotAtB(), 1000 + SHOTS_TO_KILL * GAP_MS);
    assert.equal(to("B", "player:hurt").length, SHOTS_TO_KILL, "no hurt after death");
  });

  it("a dead player's next host is whole", () => {
    const { world, to } = duel();
    for (let i = 0; i < SHOTS_TO_KILL; i++) world.shoot("A", shotAtB(), 1000 + i * GAP_MS);
    world.host("B", "1_2_beeble", "claim");
    world.host("B", "1_2_beeble", "possess");
    assert.deepEqual(to("A", "player:hurt").at(-1), { t: "player:hurt", id: "B", health: PLAYER_HEALTH, wounds: [] });
  });

  it("refuses a shot faster than the weapon fires, from an unarmed hand, a MAV Unit or far from the shooter", () => {
    const { world, to } = duel();
    // Misses: every accepted shot still reaches B (`shot`), and none hurts it.
    const miss: ShootMessage = { ...shotAtB(), hits: [] };
    world.shoot("A", miss, 1000);
    world.shoot("A", miss, 1000 + GAP_MS / 4);
    assert.equal(to("B", "shot").length, 1, "too fast");
    world.move("A", standing(0, ""));
    world.shoot("A", miss, 5000);
    world.move("A", { ...standing(0), fm: "mav" });
    world.shoot("A", miss, 6000);
    world.move("A", standing(0));
    world.shoot("A", { ...miss, o: [50, 2, 0] }, 7000);
    assert.equal(to("B", "shot").length, 1, "unarmed, a MAV Unit, far from the shooter");
    world.shoot("A", shotAtB(), 8000);
    assert.equal(to("B", "player:hurt").length, 1, "a fair shot still lands");
  });

  it("refuses a hit on a player not where it is said to stand, or out of the weapon's range", () => {
    const { world, to } = duel();
    world.shoot("A", { ...shotAtB(), hits: [{ ...HIT_B, at: [40, 1, 0] }] }, 1000);
    world.move("B", standing(REVOLVER_SPEC.range + 20));
    world.shoot("A", { ...shotAtB(), hits: [{ ...HIT_B, at: [REVOLVER_SPEC.range + 20, 1, 0] }] }, 1000 + GAP_MS);
    assert.equal(to("B", "player:hurt").length, 0);
    assert.equal(to("B", "shot").length, 2, "the shots themselves still fly");
    assert.deepEqual(to("B", "shot")[0].hits, []);
  });
});
