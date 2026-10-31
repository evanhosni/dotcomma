import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { computeVertexData } from "../../src/utils/workers/vertexCompute";
import { biomeSiteAt } from "../../src/utils/workers/voronoi";
import { districtLayoutsNear } from "../../src/utils/workers/underground/districts";
import { systemAt } from "../../src/utils/workers/underground/systems";
import type { MouthPiece, RoomPiece, TunnelSystem } from "../../src/utils/workers/underground/types";
import { biomeIdOf } from "../../src/world/content/config";
import { DOMAIN_CONFIGS } from "../../src/world/domains";
import { layoutDoors, manholeCenter, manholeIdOf, sideRoomOf, type SewerLayout } from "../../src/utils/workers/underground/sewers";
import { CITY_BIOME_ID } from "../../src/world/constants";
import { tunnelColliderBodies } from "../../src/utils/workers/underground/colliderBodies";
import { GroundBody } from "../src/game/physics/groundBody.js";
import { sampleTunnelChunk } from "../src/game/physics/tunnels.js";
import { PhysicsWorld } from "../src/game/physics/physicsWorld.js";
import { TICK_SECONDS } from "../src/game/tick.js";

const MOUNTAIN_BIOME_ID = biomeIdOf(DOMAIN_CONFIGS.overworld, "mountain");

/** The first mountain cave around the origin that `has` something. */
const firstCave = (has: (s: TunnelSystem) => boolean): TunnelSystem => {
  for (let ring = 0; ring <= 30; ring++) {
    for (let ix = -ring; ix <= ring; ix++) {
      for (let iz = -ring; iz <= ring; iz++) {
        if (Math.max(Math.abs(ix), Math.abs(iz)) !== ring || biomeSiteAt(ix, iz).zone.biome.id !== MOUNTAIN_BIOME_ID) continue;
        const s = systemAt("cave", MOUNTAIN_BIOME_ID, ix, iz);
        if (s && has(s)) return s;
      }
    }
  }
  throw new Error("no such cave");
};

/**
 * An NPC goes where the player goes (physics/tunnelRules.ts on the server's TunnelSpace): spawned on a
 * sewer side room's floor it stays there, held in by the closed door; with the door open it walks out;
 * a closed manhole is street; down an open one it falls to the junction's floor. In-place generation
 * (no worker), ticked as the entity manager ticks: work, step, world step, pose.
 */

const CAPSULE = { radius: 0.5, height: 2 };
const AREA = { minX: 1000, minZ: -7000, maxX: 2000, maxZ: -6000 };
const WALK = 4;

let pw: PhysicsWorld;
let layouts: SewerLayout[];

const tick = (body: GroundBody, n: number, vx = 0, vz = 0): void => {
  for (let i = 0; i < n; i++) {
    pw.workFor(Infinity);
    pw.ensureQueries();
    body.step(TICK_SECONDS, vx, vz, null);
    pw.step();
    body.resolvePose(TICK_SECONDS, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
  }
};

const settle = (body: GroundBody): void => {
  for (let i = 0; i < 400 && !body.ready; i++) tick(body, 1);
  assert.ok(body.ready, "ready once its chunks are built");
};

describe("an NPC in the tunnels", () => {
  before(async () => {
    pw = await PhysicsWorld.create();
    layouts = [...districtLayoutsNear(CITY_BIOME_ID, AREA, 0).values()];
    assert.ok(layouts.length > 0, "the city has sewers here");
  });
  after(() => pw.free());

  const sideRoom = () => {
    for (const layout of layouts) {
      for (const n of layout.nodes.values()) {
        if (n.door < 0) continue;
        const door = layoutDoors(layout).find((d) => d.id.endsWith(`|${n.key}|${n.door}`))!;
        return { room: sideRoomOf(layout.district, n, n.door), floor: n.floor, door };
      }
    }
    throw new Error("no side room");
  };

  const manhole = () => {
    for (const layout of layouts) {
      for (const n of layout.nodes.values()) {
        if (!n.manhole || !n.manholeInfo) continue;
        return { id: manholeIdOf(layout.district, n), ...manholeCenter(layout.district, n), street: n.manholeInfo.streetY, floor: n.floor };
      }
    }
    throw new Error("no manhole");
  };

  it("spawned in a side room, it stands on the room's floor, and the closed door holds it in", () => {
    const { room, floor } = sideRoom();
    const body = new GroundBody(pw, room.cx, room.cz, CAPSULE, floor);
    try {
      settle(body);
      tick(body, 20);
      assert.ok(Math.abs(body.y - floor) < 0.3, `on the floor (${(body.y - floor).toFixed(2)}u off), not the street`);
      tick(body, 60, -room.outX * WALK, -room.outZ * WALK);
      const from = Math.hypot(body.x - room.cx, body.z - room.cz);
      assert.ok(from < 3.5, `still in the room after walking at the door (${from.toFixed(2)}u from its centre)`);
      assert.ok(Math.abs(body.y - floor) < 0.3, "still on its floor");
    } finally {
      body.dispose();
    }
  });

  it("with the door open, it walks out of the side room", () => {
    const { room, floor, door } = sideRoom();
    const body = new GroundBody(pw, room.cx, room.cz, CAPSULE, floor);
    try {
      settle(body);
      pw.setTunnelOpen(door.id, true);
      tick(body, 80, -room.outX * WALK, -room.outZ * WALK);
      const from = Math.hypot(body.x - room.cx, body.z - room.cz);
      assert.ok(from > 5, `out through the door (${from.toFixed(2)}u from the room's centre)`);
      assert.ok(body.y < floor + 1, "in the sewer, not lifted onto the street");
    } finally {
      pw.setTunnelOpen(door.id, false);
      body.dispose();
    }
  });

  it("a closed manhole is street", () => {
    const m = manhole();
    const body = new GroundBody(pw, m.x, m.z, CAPSULE, m.street);
    try {
      settle(body);
      tick(body, 60);
      assert.ok(Math.abs(body.y - m.street) < 0.6, `on the street over the cover (${(body.y - m.street).toFixed(2)}u)`);
    } finally {
      body.dispose();
    }
  });

  it("spawned in a cave's side room, it stands on the room's floor and stays underground", () => {
    const room = firstCave((s) => s.pieces.some((p) => p.kind === "room")).pieces.find((p): p is RoomPiece => p.kind === "room")!;
    const x = (room.ax + room.bx) / 2;
    const z = (room.az + room.bz) / 2;
    const body = new GroundBody(pw, x, z, CAPSULE, room.ay);
    try {
      settle(body);
      tick(body, 20);
      assert.ok(Math.abs(body.y - room.ay) < 1, `on the room's floor (${(body.y - room.ay).toFixed(2)}u off)`);
      tick(body, 60, WALK, 0);
      tick(body, 60, 0, WALK);
      const ground = computeVertexData(body.x, body.z).height;
      assert.ok(body.y < ground - 3, `still under the mountain (${(ground - body.y).toFixed(1)}u of rock over it)`);
    } finally {
      body.dispose();
    }
  });

  it("from inside a cave's mouth it walks out onto the slope, unblocked", () => {
    const mouth = firstCave((s) => s.pieces.some((p) => p.kind === "mouth")).pieces.find((p): p is MouthPiece => p.kind === "mouth")!;
    // A few units in from the opening's floor point, walking back out along the section.
    const inX = mouth.ox + mouth.dx * 4;
    const inZ = mouth.oz + mouth.dz * 4;
    const body = new GroundBody(pw, inX, inZ, CAPSULE, mouth.oy - mouth.grade * 4);
    try {
      settle(body);
      tick(body, 120, -mouth.dx * WALK, -mouth.dz * WALK);
      const out = (body.x - mouth.ox) * -mouth.dx + (body.z - mouth.oz) * -mouth.dz;
      assert.ok(out > 8, `out past the opening (${out.toFixed(2)}u in front of it after 120 ticks at ${WALK}u/s)`);
      const ground = computeVertexData(body.x, body.z).height;
      assert.ok(Math.abs(body.y - ground) < 1.5, `on the slope (${(body.y - ground).toFixed(2)}u off)`);
    } finally {
      body.dispose();
    }
  });

  it("every tunnel collider body has its own key: the floor column at Evan's fall is never dropped", () => {
    // (4854.5, -3358.5): two neighbouring cave chunks each own a column centred at (4856, -3352) — the
    // floor (1954 triangles) and a sliver of patch past the other chunk's edge. Keyed by position, the
    // client built one of the two.
    const spot = { x: 4854.5, z: -3358.5 };
    const gx = Math.floor(spot.x / 256);
    const gz = Math.floor(spot.z / 256);
    const keys = new Set<string>();
    const positions = new Map<string, number>();
    let floorTris = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const part of sampleTunnelChunk(gx + dx, gz + dz)) {
          for (const b of tunnelColliderBodies(part, () => false)) {
            assert.ok(b.key, "every tunnel body carries a key");
            assert.ok(!keys.has(b.key!), `the key ${b.key} is unique`);
            keys.add(b.key!);
            const at = `${b.x}_${b.z}`;
            positions.set(at, (positions.get(at) ?? 0) + 1);
            if (at === "4856_-3352") floorTris = Math.max(floorTris, (b.mesh?.indices.length ?? 0) / 3);
          }
        }
      }
    }
    assert.ok(positions.get("4856_-3352")! >= 2, "two chunks' columns share the position (the hazard this pins)");
    assert.ok(floorTris > 1000, `the floor column is among the keyed bodies (${floorTris} triangles)`);
  });

  it("down an open manhole it falls to the junction's floor, and stays", () => {
    const m = manhole();
    pw.setTunnelOpen(m.id, true);
    const body = new GroundBody(pw, m.x, m.z, CAPSULE, m.street);
    try {
      settle(body);
      tick(body, 120);
      assert.ok(Math.abs(body.y - m.floor) < 0.5, `on the junction's floor (${(body.y - m.floor).toFixed(2)}u off; street ${(m.street - m.floor).toFixed(1)}u up)`);
      tick(body, 60);
      assert.ok(body.y < m.street - 3, "never lifted back onto the street");
    } finally {
      pw.setTunnelOpen(m.id, false);
      body.dispose();
    }
  });
});
