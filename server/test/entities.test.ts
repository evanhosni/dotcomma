import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EntityManager, TICK_MS, type PlayerView } from "../src/game/entities/manager.js";
import type { ServerMessage } from "../src/protocol.js";

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
const regBeeble = (m: EntityManager, who: string, id = ID) =>
  m.register(who, "glitch-city", [{ id, kind: "beeble", x: 10, y: 3, z: 20 }]);
const ticks = (m: EntityManager, n: number, t0: number) => {
  for (let i = 1; i <= n; i++) m.tick(t0 + i * TICK_MS);
};

describe("EntityManager (server authority)", () => {
  it("registration answers with the full record; unknown kinds are static", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
    m.register("A", "glitch-city", [{ id: "1_2_building", kind: "building", x: 1, y: 0, z: 2 }]);
    const u = h.to("A")[0];
    assert.equal(u.t, "entity:update");
    assert.equal(u.x, 1);
    assert.equal(u.sm, undefined, "no machine for a static kind");
    assert.equal(m.get("1_2_building")!.runner, null);
    regBeeble(m, "A");
    assert.ok(m.get(ID)!.runner, "beeble gets a state machine runner");
  });

  it("the beeble machine runs on the server: it wanders, publishes pose + clip + state to every registrant", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
    regBeeble(m, "A");
    regBeeble(m, "B");
    h.setPlayer("A", 500, 500);
    h.clear();
    const t0 = Date.now();
    ticks(m, 20, t0); // 2s
    const e = m.get(ID)!;
    assert.equal(e.sm, "idle-walk");
    assert.equal(e.clip, "walk");
    assert.ok(Math.hypot(e.x - 10, e.z - 20) > 1, `moved from spawn (${e.x.toFixed(2)}, ${e.z.toFixed(2)})`);
    const ua = h.to("A");
    const ub = h.to("B");
    assert.ok(ua.length > 0 && ub.length > 0, "both registrants receive updates");
    assert.ok(ua.some((u: any) => u.clip === "walk" && typeof u.clipT0 === "number"), "clip published with start time");
    assert.ok(ua.some((u: any) => u.sm === "idle-walk"), "machine state id published");
    assert.ok(ua.every((u: any) => u.y === undefined || u.y === 3), "y stays client-resolved (never integrated on the ground)");
  });

  it("ANY player in front of it alerts it (nearest player, no owner)", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
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
    assert.equal(e.clip, "idle");
    assert.equal(e.vx, 0);
    assert.equal(e.vz, 0);
  });

  it("a forwarded click from a nearby player makes it ascend (vy > 0, once-clip)", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
    regBeeble(m, "A");
    regBeeble(m, "B");
    const t0 = Date.now();
    h.setPlayer("A", 500, 500);
    ticks(m, 2, t0);
    const e = m.get(ID)!;
    h.setPlayer("B", e.x + Math.sin(e.ry) * 3, e.z + Math.cos(e.ry) * 3);
    ticks(m, 3, t0 + 200); // → alert
    assert.equal(e.sm, "alert");
    m.interact("B", ID, "mouse-left-click", m.playersFor("glitch-city"));
    ticks(m, 5, t0 + 500);
    assert.equal(e.sm, "ascending");
    assert.equal(e.clip, "ascend");
    assert.equal(typeof e.once, "boolean", "loop mode published with the clip");
    assert.ok(e.vy > 0, "rising");
    assert.ok(e.y > 3, "y integrates while vy is driven");
    // A click from far away is ignored.
    const h2 = makeHost();
    const m2 = new EntityManager(h2.host);
    regBeeble(m2, "A");
    h2.setPlayer("A", 500, 500);
    ticks(m2, 2, t0);
    m2.interact("A", ID, "mouse-left-click", m2.playersFor("glitch-city"));
    ticks(m2, 2, t0 + 200);
    assert.notEqual(m2.get(ID)!.sm, "ascending", "far click ignored");
  });

  it("doors: door:<i> toggles replicated state and broadcasts", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
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

  it("last registrant out forgets the entity (machine disposed)", () => {
    const h = makeHost();
    const m = new EntityManager(h.host);
    regBeeble(m, "A");
    regBeeble(m, "B");
    m.unregister("A", [ID]);
    assert.equal(m.size, 1);
    m.removeSession("B");
    assert.equal(m.size, 0);
  });
});
