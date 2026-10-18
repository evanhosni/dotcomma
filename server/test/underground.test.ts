import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { buildUndergroundChunk } from "../../src/utils/workers/underground/chunkMesh";
import { compileField, rockEscapeAt, surfaceAboveAt, type FieldFn } from "../../src/utils/workers/underground/tunnelField";
import type { ColumnCollider, TunnelPiece, UndergroundChunk } from "../../src/utils/workers/underground/types";
import { CITY_BIOME_ID } from "../../src/world/constants";
import { PhysicsWorld } from "../src/game/physics/physicsWorld.js";
import { Walker } from "../src/game/physics/walker.js";

/**
 * The player's capsule over a sewer's real column colliders (the client's step, replayed at its frame
 * times): the resolver never embeds it in a wall while every collider is there, one frame WITHOUT a
 * wall's collider embeds it at sprint speed, and the tunnel's wall backstop (rockEscapeAt, what
 * player/undergroundMode.ts applies) gets it out. Evan's stuck spot (1492.2, -13.2, -6652.2): a junction
 * box of the city sewer at (1490.8, -6652.5), the channel's side wall through (1492.5, -6653.53). And
 * Evan's bouncing spot (5891.5, -13.4, -9210.3): a pipe's channel, its floor at -15.15 under 0.81u of
 * sewage, where a sunk capsule lifted to a coarse air sample landed UNDER the floor and sank again.
 */

const CAPSULE = { radius: 0.5, height: 2 };
const WALK = 15;
const SPRINT = 45;
const FRAME = 1 / 60;
const CORNER = { x: 1492.5, z: -6653.53 };
/** Wall a's normal (into the channel's air) and wall b's. */
const NA = { x: -0.97, z: -0.26 };
const NB = { x: -0.26, z: 0.97 };
const CHANNEL_FLOOR = -15.5;
const PROBE_OVER_FEET = 0.3;
const WALL_COLUMN = "1496_-6648";
/** The bouncing spot: the channel floor, the sewage over it and the client's swim input there. */
const CHANNEL = { x: 5891.5, z: -9210.3, floor: -15.15, liquid: -14.34, viscosity: 2.5 };

let pw: PhysicsWorld;
let field: FieldFn;
const columns = new Map<string, { body: RAPIER.RigidBody; col: ColumnCollider }>();

const addColumn = (col: ColumnCollider): void => {
  const body = pw.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(col.x, 0, col.z));
  pw.world.createCollider(RAPIER.ColliderDesc.trimesh(col.vertices, col.indices), body);
  columns.set(`${col.x}_${col.z}`, { body, col });
};

const settle = (w: Walker, frames: number): void => {
  for (let i = 0; i < frames; i++) {
    w.step(FRAME, 0, 0);
    pw.step();
  }
};
const walk = (w: Walker, dir: { x: number; z: number }, speed: number, frames: number): number => {
  const p0 = w.position();
  const len = Math.hypot(dir.x, dir.z) || 1;
  for (let i = 0; i < frames; i++) {
    w.step(FRAME, (dir.x / len) * speed, (dir.z / len) * speed);
    pw.step();
  }
  const p1 = w.position();
  return Math.hypot(p1.x - p0.x, p1.z - p0.z);
};
/** The field at the probe point (what undergroundMode reads: 0.3 over the feet, where the channel's
 *  floor is 0.4 under it, so clear of every wall it reads the floor's -0.4). */
const probeField = (w: Walker): number => {
  const p = w.position();
  return field(p.x, w.feetY() + PROBE_OVER_FEET, p.z);
};
/** How far the axis stands behind a wall's plane (negative: in the air before it). */
const behind = (w: Walker, n: { x: number; z: number }): number => {
  const p = w.position();
  return -((p.x - CORNER.x) * n.x + (p.z - CORNER.z) * n.z);
};

describe("the player in a sewer", () => {
  before(async () => {
    pw = await PhysicsWorld.create();
    const pieces: TunnelPiece[] = [];
    for (const [minX, minZ] of [[1280, -6912], [1280, -6656], [5632, -9472], [5632, -9216], [5888, -9472], [5888, -9216]]) {
      const chunk = buildUndergroundChunk({ minX, minZ, maxX: minX + 256, maxZ: minZ + 256 }, "sewer", CITY_BIOME_ID) as UndergroundChunk | null;
      assert.ok(chunk, `the sewer chunk at (${minX}, ${minZ}) exists`);
      pieces.push(...chunk.pieces);
      for (const col of chunk.colliders) addColumn(col);
    }
    assert.ok(columns.has(WALL_COLUMN), "the corner's column collider exists");
    field = compileField(pieces, { withCones: false });
    pw.markQueriesDirty();
    // The first cast before a step misses: warm the query pipeline.
    const w = new Walker(pw, 1490.8, -14.2, -6652.5, CAPSULE);
    settle(w, 5);
    w.dispose();
  });
  after(() => pw.free());

  it("never embeds the capsule in the corner's walls while every collider is there", () => {
    let worst = -Infinity;
    for (let angle = 0; angle < 360; angle += 15) {
      const dir = { x: Math.cos((angle * Math.PI) / 180), z: Math.sin((angle * Math.PI) / 180) };
      for (const [sa, sb] of [[0.7, 0.7], [0.7, 3]]) {
        const w = new Walker(pw, CORNER.x + NA.x * sa + NB.x * sb, CHANNEL_FLOOR + 0.1, CORNER.z + NA.z * sa + NB.z * sb, CAPSULE);
        settle(w, 5);
        for (let i = 0; i < 90; i++) {
          w.step(FRAME, dir.x * SPRINT, dir.z * SPRINT);
          pw.step();
          worst = Math.max(worst, behind(w, NA), behind(w, NB));
        }
        w.dispose();
      }
    }
    // The axis stays the capsule's radius (and the contact offset) from every wall.
    assert.ok(worst < -0.5, `the axis came within ${(-worst).toFixed(3)}u of a wall`);
  });

  it("one frame without the wall's collider embeds a sprinting capsule, and the wall backstop frees it", () => {
    const w = new Walker(pw, CORNER.x + NA.x * 1.5 + NB.x * 1.5, CHANNEL_FLOOR + 0.1, CORNER.z + NA.z * 1.5 + NB.z * 1.5, CAPSULE);
    settle(w, 10);
    const into = { x: -NA.x, z: -NA.z };
    walk(w, into, WALK, 60);
    assert.ok(behind(w, NA) < -0.5, "pressed against the wall, the axis is a radius off it");
    const { body, col } = columns.get(WALL_COLUMN)!;
    pw.world.removeRigidBody(body);
    pw.markQueriesDirty();
    walk(w, into, SPRINT, 1);
    addColumn(col);
    pw.markQueriesDirty();
    const embedded = probeField(w);
    assert.ok(embedded > 0.1 && behind(w, NA) > 0.1, `one sprint frame put the axis ${behind(w, NA).toFixed(3)}u into the wall (field ${embedded.toFixed(3)})`);
    // The backstop, the same frame: a push beside the capsule, out to the radius and a little air.
    const p = w.position();
    const out = rockEscapeAt(field, p.x, w.feetY() + PROBE_OVER_FEET, p.z, CAPSULE.radius + 0.1);
    assert.ok(out && !out.vertical, "the escape is a push beside the capsule, not a lift");
    w.placeFeet(out.x, w.feetY() + (out.y - (w.feetY() + PROBE_OVER_FEET)), out.z);
    assert.ok(behind(w, NA) <= -0.5, `freed: the axis is ${(-behind(w, NA)).toFixed(3)}u before the wall`);
    // Walking is a walk again, and the wall holds.
    assert.ok(walk(w, NA, WALK, 60) > 10, "walks away from the wall");
    walk(w, into, WALK, 60);
    assert.ok(behind(w, NA) < -0.5 && behind(w, NA) > -0.8, "stopped by the wall at the capsule's radius");
    w.dispose();
  });

  it("deeper in, the walls hold nothing and the way out is up: the sunk rule's lift", () => {
    const w = new Walker(pw, CORNER.x + NA.x * 1.5 + NB.x * 1.5, CHANNEL_FLOOR + 0.1, CORNER.z + NA.z * 1.5 + NB.z * 1.5, CAPSULE);
    settle(w, 10);
    const into = { x: -NA.x, z: -NA.z };
    walk(w, into, WALK, 60);
    const { body, col } = columns.get(WALL_COLUMN)!;
    pw.world.removeRigidBody(body);
    pw.markQueriesDirty();
    walk(w, into, SPRINT, 1);
    addColumn(col);
    pw.markQueriesDirty();
    // From inside, a push deeper goes through the rock (nothing stops a sweep that starts inside).
    assert.ok(walk(w, into, SPRINT, 1) > 0.5, "a capsule inside the wall walks on through the rock");
    const p = w.position();
    const py = w.feetY() + PROBE_OVER_FEET;
    assert.ok(field(p.x, py, p.z) > 0.5, "well into the rock under the walkway");
    const out = rockEscapeAt(field, p.x, py, p.z, CAPSULE.radius + 0.1);
    assert.ok(out && out.vertical, "the nearest air is the walkway over it: the lift's case");
    let air = NaN;
    for (let s = 0.25; s <= 6; s += 0.25) if (field(p.x, py + s, p.z) < 0) { air = py + s; break; }
    assert.ok(!Number.isNaN(air) && air > -14.4 && air < -14.0, `the air over the rock is the walkway's (${air.toFixed(2)})`);
    w.dispose();
  });

  it("a capsule sunk under the channel floor rises back onto it; the sunk lift lands on it", () => {
    for (const swim of [false, true]) {
      const w = new Walker(pw, CHANNEL.x, CHANNEL.floor - 0.25, CHANNEL.z, CAPSULE);
      (w as any).input.swim = swim ? { surfaceY: CHANNEL.liquid, viscosity: CHANNEL.viscosity, jumpPressed: false } : null;
      const feet: number[] = [];
      for (let i = 0; i < 60; i++) {
        w.step(FRAME, 0, 0);
        pw.step();
        feet.push(w.feetY());
      }
      let reversals = 0;
      for (let i = 2; i < feet.length; i++) if ((feet[i] - feet[i - 1]) * (feet[i - 1] - feet[i - 2]) < -1e-6) reversals++;
      const last = feet[feet.length - 1];
      assert.ok(last > CHANNEL.floor && last < CHANNEL.floor + 0.15, `swim=${swim}: rose onto the floor (feet ${last.toFixed(3)}, floor ${CHANNEL.floor})`);
      assert.ok(reversals === 0, `swim=${swim}: rose monotonically (${reversals} reversals)`);
      w.dispose();
    }
    // The sunk lift (undergroundMode): from half a unit under, onto the floor's surface, not under it.
    const py = CHANNEL.floor - 0.5 + PROBE_OVER_FEET;
    assert.ok(field(CHANNEL.x, py, CHANNEL.z) > 0.15, "the probe point reads rock: the sunk rule's case");
    const surface = surfaceAboveAt(field, CHANNEL.x, py, CHANNEL.z, 0.25, 6);
    assert.ok(Math.abs(surface - CHANNEL.floor) < 0.03, `the lift finds the floor's surface (${surface.toFixed(3)})`);
  });

  it("a floor embed is a lift, not a push: the escape reports it vertical", () => {
    // Under the channel's floor at the corner's air.
    const x = CORNER.x + NA.x * 1.2 + NB.x * 1.5;
    const z = CORNER.z + NA.z * 1.2 + NB.z * 1.5;
    assert.ok(field(x, CHANNEL_FLOOR + 0.3, z) < 0, "the point over the floor is air");
    const out = rockEscapeAt(field, x, CHANNEL_FLOOR - 0.1, z, 0.6);
    assert.ok(out && out.vertical, "the rock under a floor reads vertical");
  });
});
