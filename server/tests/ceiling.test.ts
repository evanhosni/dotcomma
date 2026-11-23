import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as RAPIER from "@dimforge/rapier3d-compat";
import { createCharacter, createStepResult, stepCharacter } from "../../src/physics";
import type { CharacterInput } from "../../src/physics/types";
import { CONTROLLER_CONTACT_OFFSET, SUPPORT_REST_GAP } from "../../src/physics/constants";

/** The player steps once a frame. */
const DT = 1 / 60;

/** A jump that hits a ceiling falls at once: the upward speed the ceiling stopped is dropped, not drained
 *  by gravity with the head held against the ceiling; and it lands, never stopping over the floor on the
 *  ground ray's support (physics/index.ts). */

const CAPSULE = { radius: 0.5, height: 2 };
const HEADROOM = 0.8;

describe("a jump under a ceiling", () => {
  it("falls back the step after the head reaches the ceiling, onto the floor", async () => {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0));
      world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, CAPSULE.height + HEADROOM + 0.5, 0));
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, CAPSULE.height / 2 + 0.05, 0));
      const collider = world.createCollider(RAPIER.ColliderDesc.capsule(CAPSULE.height / 2 - CAPSULE.radius, CAPSULE.radius), body);
      const character = createCharacter(RAPIER, world, CAPSULE);
      const out = createStepResult();
      const input: CharacterInput = { dirX: 0, dirZ: 0, speed: 0, jump: false, vyOverride: null };
      const step = (): number => {
        const p = body.translation();
        stepCharacter(world, character, body, collider, p.x, p.y, p.z, input, DT, out);
        world.step();
        return body.translation().y - CAPSULE.height / 2;
      };
      for (let i = 0; i < 20; i++) step();
      input.jump = true;
      const feet: number[] = [];
      for (let i = 0; i < 60; i++) {
        feet.push(step());
        input.jump = false;
      }
      const peak = Math.max(...feet);
      assert.ok(peak > HEADROOM - 0.15, `the head reached the ceiling (feet peaked ${peak.toFixed(2)}u up of ${HEADROOM}u headroom)`);
      const atCeiling = feet.filter((y) => y > peak - 0.02).length;
      assert.ok(atCeiling <= 2, `left the ceiling at once (${atCeiling} steps at it: ${feet.map((y) => y.toFixed(2)).join(" ")})`);
      assert.ok(feet[feet.length - 1] < CONTROLLER_CONTACT_OFFSET + SUPPORT_REST_GAP, `landed on the floor, not hanging over it (${feet.map((y) => y.toFixed(2)).join(" ")})`);
    } finally {
      world.free();
    }
  });
});
