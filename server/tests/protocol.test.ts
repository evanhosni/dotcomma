import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CLIP_NAME_LENGTH, MAX_CLIP_SPEED } from "../../src/net/protocol/constants";
import { parseClientMessage } from "../src/transport/utils.js";

/**
 * The server's gate on what clients send: a `move` carries the drawn pose with the movement (src/net/protocol/
 * types.ts PlayerAvatar), and anything malformed is dropped whole, so a client and server that disagree on
 * the message lose every move: these pin what the client must send.
 */

const MOVE = { t: "move", x: 1, y: 2, z: 3, vx: 0.5, vy: 0, vz: -0.5, ry: 0.25, hy: 0.1, hp: -0.2, clip: "walk", cs: 1.5, loop: "repeat", fm: "host", mh: "", md: 0 };

describe("client messages", () => {
  it("passes a move with its drawn pose through whole", () => {
    assert.deepEqual(parseClientMessage(MOVE), MOVE);
    assert.deepEqual(parseClientMessage({ ...MOVE, loop: "once" }), { ...MOVE, loop: "once" });
  });

  it("drops a move missing any pose field", () => {
    for (const key of ["hy", "hp", "clip", "cs", "loop", "fm", "mh", "md"]) {
      const { [key]: _, ...without } = MOVE as Record<string, unknown>;
      assert.equal(parseClientMessage(without), null, `without ${key}`);
    }
  });

  it("drops a move whose pose is out of range", () => {
    assert.equal(parseClientMessage({ ...MOVE, hy: NaN }), null);
    assert.equal(parseClientMessage({ ...MOVE, hp: Infinity }), null);
    assert.equal(parseClientMessage({ ...MOVE, cs: -0.1 }), null);
    assert.equal(parseClientMessage({ ...MOVE, cs: MAX_CLIP_SPEED + 1 }), null);
    assert.equal(parseClientMessage({ ...MOVE, clip: "" }), null);
    assert.equal(parseClientMessage({ ...MOVE, clip: "x".repeat(MAX_CLIP_NAME_LENGTH + 1) }), null);
    assert.equal(parseClientMessage({ ...MOVE, loop: "pingpong" }), null);
    assert.equal(parseClientMessage({ ...MOVE, fm: "ghost" }), null);
    assert.equal(parseClientMessage({ ...MOVE, md: 1.5 }), null);
    assert.equal(parseClientMessage({ ...MOVE, mh: 7 }), null);
  });

  it("passes a lone MAV Unit screwing into its host", () => {
    const screwing = { ...MOVE, fm: "mav", mh: "12_34_beeble", md: 0.4 };
    assert.deepEqual(parseClientMessage(screwing), screwing);
  });

  it("passes each host step and drops anything else", () => {
    for (const step of ["claim", "impact", "wake", "possess", "release"]) {
      assert.deepEqual(parseClientMessage({ t: "host", id: "a", step }), { t: "host", id: "a", step });
    }
    assert.equal(parseClientMessage({ t: "host", id: "a", step: "steal" }), null);
    assert.equal(parseClientMessage({ t: "host", id: "", step: "claim" }), null);
  });

  it("passes a player click with an id and drops one without", () => {
    assert.deepEqual(parseClientMessage({ t: "player:click", id: "abc" }), { t: "player:click", id: "abc" });
    assert.equal(parseClientMessage({ t: "player:click", id: "" }), null);
    assert.equal(parseClientMessage({ t: "player:click" }), null);
  });
});
