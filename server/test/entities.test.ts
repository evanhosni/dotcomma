import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import type { ServerMessage } from "../../src/net/protocol";
import { ACTOR_SPECS } from "../../src/objects/actors/catalog";
import type { ActorSpec } from "../../src/objects/actors/spec";
import type { StateMachineConfig } from "../../src/objects/actors/state/types";
import { computeVertexData } from "../../src/utils/workers/vertexCompute";
import { EntityManager, TICK_MS, type EntityManagerOptions, type PlayerView } from "../src/game/entities/manager.js";
import { PhysicsWorld } from "../src/game/physics/physicsWorld.js";

/** ONE physics world for the suite (WASM init once); every manager here runs
 *  its walkers on it with an unbounded generation budget so chunks build on
 *  the first tick instead of streaming in over several. */
let pw: PhysicsWorld;
const live: EntityManager[] = [];
const manager = (h: ReturnType<typeof makeHost>, opts: EntityManagerOptions = {}) => {
  const m = new EntityManager(h.host, pw, { workBudgetMs: Infinity, log: false, ...opts });
  live.push(m);
  return m;
};

/** Fake transport + player roster. */
const makeHost = () => {
  const players = new Map<string, PlayerView>();
  const sent: { to: string; msg: ServerMessage }[] = [];
  const host = {
    playersIn: (domain: string) => [...players.values()].filter((p) => p.domain === domain),
    sendMany: (ids: Iterable<string>, msg: ServerMessage) => {
      for (const to of ids) sent.push({ to, msg });
    },
  };
  const setPlayer = (id: string, x: number, z: number) =>
    players.set(id, { id, domain: "glitch-city", x, y: 0, z, vx: 0, vz: 0, lastMoveAt: Date.now() });
  const to = (who: string) => sent.filter((s) => s.to === who).map((s) => s.msg as any);
  const clear = () => (sent.length = 0);
  return { host, players, sent, setPlayer, to, clear };
};

const ID = "10_20_beeble";
const regBeeble = (m: EntityManager, who: string, id = ID, x = 10, z = 20) =>
  m.register(who, "glitch-city", [{ id, kind: "beeble", x, y: 3, z }]);
const ticks = (m: EntityManager, n: number, t0: number) => {
  for (let i = 1; i <= n; i++) m.tick(t0 + i * TICK_MS);
};

describe("EntityManager (server authority)", () => {
  before(async () => {
    pw = await PhysicsWorld.create();
  });
  // Every test's bodies leave the shared world with it — an abandoned capsule
  // at the common spawn point boxed the next test's beeble in (measured).
  afterEach(() => {
    for (const m of live) m.disposeAll();
    live.length = 0;
  });

  it("registration answers with the full record; kinds outside the catalog are static", () => {
    const h = makeHost();
    const m = manager(h);
    m.register("A", "glitch-city", [{ id: "1_2_building", kind: "building", x: 1, y: 0, z: 2 }]);
    const u = h.to("A")[0];
    assert.equal(u.t, "entity:update");
    assert.equal(u.x, 1);
    assert.equal(u.sm, undefined, "no machine for a building");
    assert.equal(m.get("1_2_building")!.runner, null);
    m.register("A", "glitch-city", [{ id: "5_5_prop", kind: "some-static-prop", x: 5, y: 0, z: 5 }]);
    assert.equal(m.get("5_5_prop")!.runner, null, "unknown kind → static record");
    assert.equal(m.get("5_5_prop")!.npc, null);
    regBeeble(m, "A");
    assert.ok(m.get(ID)!.runner, "beeble gets a state machine runner (catalog)");
    assert.ok(m.get(ID)!.npc, "…and a ground body");
  });

  it("the beeble machine runs on the server: it wanders, publishes pose + animation + state to every registrant", () => {
    const h = makeHost();
    const m = manager(h);
    regBeeble(m, "A");
    regBeeble(m, "B");
    h.setPlayer("A", 500, 500);
    h.clear();
    const t0 = Date.now();
    ticks(m, 20, t0); // 2s
    const e = m.get(ID)!;
    assert.equal(e.sm, "idle-walk");
    assert.equal(e.anim?.clip, "walk");
    assert.equal(e.anim?.loop, "repeat");
    assert.ok(Math.hypot(e.x - 10, e.z - 20) > 1, `moved from spawn (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
    const ua = h.to("A");
    const ub = h.to("B");
    assert.ok(ua.length > 0 && ub.length > 0, "both registrants receive updates");
    const animUpdate = ua.find((u: any) => u.anim);
    assert.ok(animUpdate, "the animation channel state is published");
    assert.equal(animUpdate.anim.clip, "walk");
    assert.equal(typeof animUpdate.anim.t0, "number", "…with the server-time clock it started on");
    assert.ok(animUpdate.anim.t0 >= t0, "clip clock is server time (the tick's now)");
    assert.ok(ua.some((u: any) => u.sm === "idle-walk"), "machine state id published");
    // y is AUTHORITATIVE: every published y sits on the server's terrain
    // (the registration's y=3 was only a hint — the ground here is ~1.9).
    const groundAt = (x: number, z: number) => computeVertexData(x, z).height;
    for (const u of ua) {
      if (u.y === undefined) continue;
      const gx = u.x ?? e.x;
      const gz = u.z ?? e.z;
      assert.ok(Math.abs(u.y - groundAt(gx, gz)) < 0.6, `published y ${u.y.toFixed(2)} vs ground ${groundAt(gx, gz).toFixed(2)}`);
    }
    assert.ok(Math.abs(e.y - groundAt(e.x, e.z)) < 0.6, "record y follows the terrain");
    // Every positional update is a server-time-stamped SNAPSHOT (the client
    // interpolates on that clock), stamped in tick order.
    const stamped = ua.filter((u: any) => u.x !== undefined);
    assert.ok(stamped.length > 5, "position published every moving tick");
    assert.ok(stamped.every((u: any) => typeof u.st === "number"), "every positional update carries st");
    for (let i = 1; i < stamped.length; i++) assert.ok(stamped[i].st >= stamped[i - 1].st, "st is non-decreasing");
    // A wander near a chunk edge requests the neighbor and un-readies the
    // walker until the next tick builds it — settle before asserting.
    for (let i = 0; i < 3 && !e.npc!.ready; i++) ticks(m, 1, t0 + 2000 + i * TICK_MS);
    assert.ok(e.npc!.ready, "its chunks were built (unbounded budget)");
  });

  it("ANY player in front of it alerts it (nearest player, no owner)", () => {
    const h = makeHost();
    const m = manager(h);
    regBeeble(m, "A");
    regBeeble(m, "B");
    h.setPlayer("A", 500, 500); // A far away
    const t0 = Date.now();
    ticks(m, 3, t0);
    const e = m.get(ID)!;
    // Put B 5u directly in front of the beeble's current facing.
    const yaw = e.ry;
    h.setPlayer("B", e.x + Math.sin(yaw) * 5, e.z + Math.cos(yaw) * 5);
    ticks(m, 3, t0 + 300);
    assert.equal(e.sm, "alert", "alerted by the second player");
    assert.equal(e.anim?.clip, "idle");
    assert.equal(e.vx, 0);
    assert.equal(e.vz, 0);
  });

  it("a forwarded click from a nearby player makes it ascend (vy > 0, clip switch)", () => {
    const h = makeHost();
    const m = manager(h);
    regBeeble(m, "A");
    regBeeble(m, "B");
    const t0 = Date.now();
    h.setPlayer("A", 500, 500);
    ticks(m, 2, t0);
    const e = m.get(ID)!;
    h.setPlayer("B", e.x + Math.sin(e.ry) * 3, e.z + Math.cos(e.ry) * 3);
    ticks(m, 3, t0 + 200); // → alert
    assert.equal(e.sm, "alert");
    const y0 = e.y;
    m.interact("B", ID, "mouse-left-click", m.playersFor("glitch-city"));
    ticks(m, 10, t0 + 500);
    assert.equal(e.sm, "ascending");
    assert.equal(e.anim?.clip, "ascend");
    assert.ok(e.vy > 0, "rising");
    assert.ok(e.y > y0 + 0.2, `y rises off the ground while vy is driven (${y0.toFixed(2)} → ${e.y.toFixed(2)})`);
    // A click from far away is ignored.
    const h2 = makeHost();
    const m2 = manager(h2);
    regBeeble(m2, "A");
    h2.setPlayer("A", 500, 500);
    ticks(m2, 2, t0);
    m2.interact("A", ID, "mouse-left-click", m2.playersFor("glitch-city"));
    ticks(m2, 2, t0 + 200);
    assert.notEqual(m2.get(ID)!.sm, "ascending", "far click ignored");
  });

  it("a `movement: \"free\"` kind flies: no gravity, no ground, its velocity integrated as-is", () => {
    // A test-only kind injected through the specs resolver (the catalog is
    // what production uses; this proves any spec with movement "free" works).
    const FLYER_SM: StateMachineConfig = {
      initialState: "soar",
      triggers: [],
      states: [
        {
          id: "soar",
          animation: { clip: "fly", speed: 1.5 },
          onUpdate: (ctx) => {
            ctx.motion.move(2, 0).fly(3).faceHeading();
          },
          transitions: [],
        },
      ],
    };
    const flyer: ActorSpec = { id: "test-flyer", stateMachine: FLYER_SM, body: "kinematic", movement: "free" };
    const h = makeHost();
    const m = manager(h, { specs: (kind) => (kind === flyer.id ? flyer : ACTOR_SPECS[kind]) });
    m.register("A", "glitch-city", [{ id: "0_0_test-flyer", kind: "test-flyer", x: 0, y: 0, z: 0 }]);
    h.setPlayer("A", 500, 500);
    const e = m.get("0_0_test-flyer")!;
    const ground = computeVertexData(0, 0).height;
    const t0 = Date.now();
    ticks(m, 10, t0); // 1s
    assert.ok(Math.abs(e.x - 2) < 0.05, `flew 2u along +x (${e.x.toFixed(2)})`);
    assert.ok(Math.abs(e.y - (ground + 3)) < 0.1, `climbed 3u above its spawn ground (${(e.y - ground).toFixed(2)})`);
    assert.equal(e.z, 0);
    assert.ok(Math.abs(e.ry - Math.PI / 2) < 1e-6, "faces its heading");
    assert.equal(e.anim?.clip, "fly");
    assert.equal(e.anim?.speed, 1.5);
    assert.ok(e.npc!.ready, "a free body needs no chunks");
  });

  it("every mouse input is forwarded as an action and raised as its flag (hover keeps the level flag)", () => {
    const h = makeHost();
    const m = manager(h);
    regBeeble(m, "A");
    h.setPlayer("A", 11, 21);
    const e = m.get(ID)!;
    const bb = e.runner!.blackboard;
    m.interact("A", ID, "mouse-hover-enter", m.playersFor("glitch-city"));
    assert.equal(bb.__mouse_hover_enter, true);
    assert.equal(bb.__mouse_hover_active, true);
    m.interact("A", ID, "mouse-scroll-up", m.playersFor("glitch-city"));
    assert.equal(bb.__mouse_scroll_up, true);
    m.interact("A", ID, "mouse-hover-leave", m.playersFor("glitch-city"));
    assert.equal(bb.__mouse_hover_active, false);
    m.interact("A", ID, "not-a-mouse-thing", m.playersFor("glitch-city"));
    assert.equal(bb["__not_a_mouse_thing"], undefined, "unknown actions never touch the blackboard");
  });

  it("doors: door:<i> toggles replicated state and broadcasts", () => {
    const h = makeHost();
    const m = manager(h);
    const B = "1_2_building";
    m.register("A", "glitch-city", [{ id: B, kind: "building", x: 0, y: 0, z: 0 }]);
    m.register("C", "glitch-city", [{ id: B, kind: "building", x: 0, y: 0, z: 0 }]);
    h.setPlayer("A", 1, 1);
    h.clear();
    m.interact("A", B, "door:2", m.playersFor("glitch-city"));
    const c = h.to("C")[0];
    assert.equal(c.state.doors[2], true, "other registrant sees the door open");
    assert.equal(m.get(B)!.state.doors[2], true);
    m.interact("A", B, "door:2", m.playersFor("glitch-city"));
    assert.equal(m.get(B)!.state.doors[2], false);
    // Late joiner gets the doors in the registration answer.
    h.clear();
    m.register("D", "glitch-city", [{ id: B, kind: "building", x: 0, y: 0, z: 0 }]);
    assert.deepEqual(h.to("D")[0].state.doors[2], false);
  });

  it("a walker holds terrain + dressing chunks and a player capsule exists while it lives; all released with it", () => {
    const h = makeHost();
    const m = manager(h);
    const t0 = Date.now();
    // The physics world is shared by the suite: drain generation jobs earlier
    // tests left queued (their building hulls) before taking the baseline.
    ticks(m, 1, t0);
    const before = pw.stats();
    regBeeble(m, "A", "700_-600_beeble", 700, -600); // a spot no earlier test holds chunks at
    h.setPlayer("A", 500, 500);
    ticks(m, 2, t0 + 100);
    const mid = pw.stats();
    assert.ok(mid.terrain.built > before.terrain.built, "terrain chunk(s) built for the walker");
    assert.ok(mid.dressing.built > before.dressing.built, "dressing chunk(s) held for the walker");
    assert.equal(mid.bodies - before.bodies >= 2, true, "walker capsule + player capsule");
    h.players.delete("A");
    ticks(m, 1, t0 + 400);
    assert.equal(pw.stats().bodies, mid.bodies - 1, "gone player → capsule removed");
    m.removeSession("A");
    const after = pw.stats();
    assert.equal(after.terrain.built, before.terrain.built, "terrain chunks released");
    assert.equal(after.dressing.built, before.dressing.built, "dressing chunks released");
    assert.equal(after.bodies, before.bodies, "no bodies left behind");
  });

  it("last registrant out forgets the entity (machine disposed)", () => {
    const h = makeHost();
    const m = manager(h);
    regBeeble(m, "A");
    regBeeble(m, "B");
    m.unregister("A", [ID]);
    assert.equal(m.size, 1);
    m.removeSession("B");
    assert.equal(m.size, 0);
  });
});
