import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetCharacterMotion } from "../../src/physics";
import { createTunnelState, createTunnelStep, stepTunnelRules } from "../../src/physics/tunnel-rules";
import type { TunnelBody } from "../../src/physics/tunnel-rules/types";
import { districtLayoutsNear } from "../../src/generation/underground/sewers/utils";
import { manholeCenter, manholeIdOf } from "../../src/generation/underground/sewers";
import { SHAFT_RADIUS } from "../../src/generation/underground/sewers/constants";
import type { ManholeInfo } from "../../src/generation/underground/types";
import { WORLD_CHUNK_SIZE } from "../../src/objects/dressing/types";
import { CITY_BIOME_ID } from "../../src/world/constants";
import { Walker } from "../src/game/physics/bodies/Walker.js";
import { PhysicsWorld } from "../src/game/physics/physicsWorld.js";
import { TERRAIN_CHUNK_SIZE } from "../src/game/physics/constants.js";
import { chunkIndicesNear } from "../src/game/physics/utils.js";
import { TICK_SECONDS } from "../src/game/constants.js";

/**
 * The player's ladder (physics/tunnel-rules/index.ts), on the server's colliders for a real manhole: walking
 * at the ladder climbs it, and out of an open shaft onto the street; a jump lets go; a closed cover stops
 * the climb under it. Driven as the Player drives it: the rules, their teleport, then the step.
 */

const CAPSULE = { radius: 0.5, height: 2 };
const AREA = { minX: 1000, minZ: -7000, maxX: 2000, maxZ: -6000 };
const WALK = 5;

let pw: PhysicsWorld;
let m: { id: string; x: number; z: number; floor: number; info: ManholeInfo };

const climber = (dt = TICK_SECONDS) => {
  const walker = new Walker(pw, m.x, m.floor + 0.05, m.z, CAPSULE);
  const state = createTunnelState();
  const step = createTunnelStep();
  const body: TunnelBody = { x: 0, y: 0, z: 0, ...CAPSULE, jump: false, moveX: 0, moveZ: 0 };
  /** `n` ticks walking along (dx, dz) (a unit direction or zero), with jump held or not. */
  const tick = (n: number, dx: number, dz: number, jump = false): void => {
    for (let i = 0; i < n; i++) {
      pw.ensureQueries();
      const p = walker.position();
      Object.assign(body, { x: p.x, y: p.y, z: p.z, jump, moveX: dx, moveZ: dz });
      stepTunnelRules(pw.tunnelSpace, state, step, body, dt);
      if (!Number.isNaN(step.teleportX)) {
        walker.body.setTranslation({ x: step.teleportX, y: step.teleportY, z: step.teleportZ }, true);
        pw.markQueriesDirty();
      }
      if (step.resetMotion) resetCharacterMotion(walker.character.state);
      const walk = step.holdWalk ? 0 : WALK;
      const pushed = step.pushX !== 0 || step.pushZ !== 0;
      walker.step(dt, pushed ? step.pushX : dx * walk, pushed ? step.pushZ : dz * walk, step.vyOverride, step.ignoreTerrain);
      pw.step();
    }
  };
  const fromShaft = (): number => Math.hypot(walker.position().x - m.x, walker.position().z - m.z);
  /** How far the capsule's center stands back from the shaft center, against the ladder's face. */
  const back = (): number => -((walker.position().x - m.x) * m.info.faceX + (walker.position().z - m.z) * m.info.faceZ);
  return { walker, state, tick, fromShaft, back };
};

describe("the ladder", () => {
  before(async () => {
    pw = await PhysicsWorld.create();
    const layout = [...districtLayoutsNear(CITY_BIOME_ID, AREA, 0).values()].find((l) => [...l.nodes.values()].some((n) => n.manhole && n.manholeInfo));
    assert.ok(layout, "the city has a manhole here");
    const n = [...layout.nodes.values()].find((n) => n.manhole && n.manholeInfo)!;
    m = { id: manholeIdOf(layout.district, n), ...manholeCenter(layout.district, n), floor: n.floor, info: n.manholeInfo! };
    for (const [store, size] of [[pw.terrain, TERRAIN_CHUNK_SIZE], [pw.dressing, WORLD_CHUNK_SIZE], [pw.tunnels, WORLD_CHUNK_SIZE]] as const) {
      const keys = chunkIndicesNear(m.x, m.z, size, 12).map(([gx, gz]) => store.request(gx, gz));
      for (let i = 0; i < 2000 && !keys.every((k) => store.isReady(k)); i++) pw.workFor(Infinity);
      assert.ok(keys.every((k) => store.isReady(k)), "its chunks are built");
    }
  });
  after(() => pw.free());

  it("walking at it climbs out of an open shaft and onto the street", () => {
    pw.setTunnelOpen(m.id, true);
    const c = climber();
    try {
      c.tick(30, 0, 0);
      assert.ok(Math.abs(c.walker.feetY() - m.floor) < 0.3, `starts on the junction's floor (${(c.walker.feetY() - m.floor).toFixed(2)}u off)`);
      for (let i = 0; i < 240 && c.fromShaft() < SHAFT_RADIUS + 1; i++) c.tick(1, m.info.faceX, m.info.faceZ);
      c.tick(10, 0, 0);
      const street = m.info.streetY;
      assert.ok(c.fromShaft() > SHAFT_RADIUS, `walked off the top, out of the shaft (${c.fromShaft().toFixed(2)}u from its center)`);
      assert.ok(Math.abs(c.walker.feetY() - street) < 0.6, `on the street (${(c.walker.feetY() - street).toFixed(2)}u off)`);
      assert.equal(c.state.column, null, "out of the manhole's column");
    } finally {
      pw.setTunnelOpen(m.id, false);
      c.walker.dispose();
    }
  });

  it("a jump pushes off the ladder, and a walk still held at it walks back and grabs it", () => {
    pw.setTunnelOpen(m.id, true);
    const c = climber(1 / 60);
    try {
      c.tick(30, 0, 0);
      c.tick(60, m.info.faceX, m.info.faceZ);
      const held = c.back();
      const climbed = c.walker.feetY() - m.floor;
      assert.ok(climbed > 1.5 && c.state.onLadder, `on the ladder, ${climbed.toFixed(2)}u up`);
      c.tick(1, m.info.faceX, m.info.faceZ, true);
      assert.ok(!c.state.onLadder, "let go");
      let pushed = 0;
      for (let i = 0; i < 30; i++) {
        c.tick(1, m.info.faceX, m.info.faceZ);
        pushed = Math.max(pushed, c.back() - held);
      }
      assert.ok(pushed > 0.3, `pushed out from the ladder (${pushed.toFixed(2)}u)`);
      assert.ok(c.state.onLadder, "grabbed again, the walk still held");
      assert.ok(c.walker.feetY() - m.floor > 1, `caught it before the floor (${(c.walker.feetY() - m.floor).toFixed(2)}u up)`);
    } finally {
      pw.setTunnelOpen(m.id, false);
      c.walker.dispose();
    }
  });

  it("under a closed cover the climb stops beneath it", () => {
    const c = climber();
    try {
      c.tick(30, 0, 0);
      c.tick(240, m.info.faceX, m.info.faceZ);
      const head = c.walker.feetY() + CAPSULE.height;
      assert.ok(c.state.onLadder, "still on the ladder");
      assert.ok(head < m.info.streetY && head > m.info.streetY - 0.6, `hanging under the cover (head ${(m.info.streetY - head).toFixed(2)}u under the street)`);
    } finally {
      c.walker.dispose();
    }
  });
});
