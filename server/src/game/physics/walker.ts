import * as RAPIER from "@dimforge/rapier3d-compat";
import {
  createCharacter,
  createStepResult,
  disposeCharacter,
  stepCharacter,
  type Character,
  type CharacterInput,
  type CharacterStepResult,
} from "../../../../src/physics/characterMovement";
import type { PhysicsWorld } from "./world.js";

/**
 * WALKER — a kinematic capsule driven by THE shared character resolver
 * (src/physics/characterMovement.ts): the local player's exact movement
 * code — contact offset, 25–45° uphill slowdown, fall-line slide above 40°,
 * gravity with ray-based support, substepped controller solve — imported from
 * the client's source through the esbuild bundle, the same way the state
 * machine runner is. There is no server copy of any movement rule.
 */

export interface CapsuleShape {
  radius: number;
  /** Total height, feet to top. */
  height: number;
}

export class Walker {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly character: Character;
  readonly halfHeight: number;
  /** Filled by every step(). */
  readonly last: CharacterStepResult = createStepResult();
  private readonly input: CharacterInput = { dirX: 0, dirZ: 0, speed: 0, jump: false, vyOverride: null };

  constructor(private readonly pw: PhysicsWorld, x: number, feetY: number, z: number, shape: CapsuleShape) {
    this.halfHeight = shape.height / 2;
    ({ body: this.body, collider: this.collider } = pw.createCapsule(x, feetY, z, shape.radius, shape.height));
    this.character = createCharacter(RAPIER, pw.world, shape);
  }

  /** Body center. */
  position(): RAPIER.Vector {
    return this.body.translation();
  }

  feetY(): number {
    return this.body.translation().y - this.halfHeight;
  }

  /** Put the body's feet at `feetY` (teleport; velocity cleared). */
  placeFeet(x: number, feetY: number, z: number): void {
    this.body.setTranslation({ x, y: feetY + this.halfHeight, z }, true);
    this.character.state.vy = 0;
  }

  /** One tick: a horizontal VELOCITY intent (u/s) — and, for a driven vertical
   *  (an NPC's ascend), `vy` — resolved exactly as the player's input is. The
   *  body's next translation is set; the world step applies it. */
  step(dt: number, vx: number, vz: number, vy: number | null = null): CharacterStepResult {
    const p = this.body.translation();
    this.input.dirX = vx;
    this.input.dirZ = vz;
    this.input.speed = Math.hypot(vx, vz);
    this.input.vyOverride = vy;
    return stepCharacter(this.pw.world, this.character, this.body, this.collider, p.x, p.y, p.z, this.input, dt, this.last);
  }

  dispose(): void {
    disposeCharacter(this.pw.world, this.character);
    this.pw.removeBody(this.body);
  }
}
