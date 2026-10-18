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
import { createSurfaceSampler } from "../../../../src/physics/movementModifiers";
import type { PhysicsWorld } from "./physicsWorld.js";

/** A kinematic capsule on THE shared character resolver (src/physics/characterMovement.ts) — no server copy of any movement rule. */

export interface CapsuleShape {
  radius: number;
  /** Feet to top. */
  height: number;
}

/** Ticks between surface samples (PhysicsWorld.surfaceModifiersAt): a drift's edge is metres wide, an NPC walks ~0.1u a tick. */
const SURFACE_SAMPLE_TICKS = 10;

export class Walker {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly character: Character;
  readonly halfHeight: number;
  /** Filled by every step(). */
  readonly lastStep: CharacterStepResult = createStepResult();
  private readonly surface = createSurfaceSampler(SURFACE_SAMPLE_TICKS, (x, z, feetY, answer) => this.pw.surfaceModifiersAt(x, z, feetY, answer));
  private readonly input: CharacterInput = { dirX: 0, dirZ: 0, speed: 0, jump: false, vyOverride: null, surface: this.surface.modifiers };

  constructor(private readonly pw: PhysicsWorld, x: number, feetY: number, z: number, shape: CapsuleShape) {
    this.halfHeight = shape.height / 2;
    ({ body: this.body, collider: this.collider } = pw.createCapsule(x, feetY, z, shape.radius, shape.height));
    this.character = createCharacter(RAPIER, pw.world, shape);
  }

  /** Body CENTER (see feetY). */
  position(): RAPIER.Vector {
    return this.body.translation();
  }

  feetY(): number {
    return this.body.translation().y - this.halfHeight;
  }

  /** Teleport; velocity cleared. */
  placeFeet(x: number, feetY: number, z: number): void {
    this.body.setTranslation({ x, y: feetY + this.halfHeight, z }, true);
    this.character.state.vy = 0;
  }

  /** vx/vz: a velocity intent (u/s); vy: a driven vertical (an NPC's ascend). Sets the
   *  body's next translation; the world step applies it. */
  step(dt: number, vx: number, vz: number, vy: number | null = null): CharacterStepResult {
    const p = this.body.translation();
    this.input.dirX = vx;
    this.input.dirZ = vz;
    this.input.speed = Math.hypot(vx, vz);
    this.input.vyOverride = vy;
    this.surface.sample(p.x, p.z, p.y - this.halfHeight);
    return stepCharacter(this.pw.world, this.character, this.body, this.collider, p.x, p.y, p.z, this.input, dt, this.lastStep);
  }

  dispose(): void {
    disposeCharacter(this.pw.world, this.character);
    this.pw.removeBody(this.body);
  }
}
