import type Rapier from "@dimforge/rapier3d-compat";
import type { LiquidKind, MovementModifiers } from "./movement-modifiers/types";

export interface CharacterShape {
  height: number;
  radius: number;
}

/** Persists between steps; plain numbers mutated in place. */
export interface CharacterMotionState {
  vy: number;
  slideSpeed: number;
  slideDirX: number;
  slideDirY: number;
  slideDirZ: number;
  softSlopeTime: number;
  steepSlopeTime: number;
  /** Rising out of the water after a breach: plain gravity until the rise ends. */
  breaching: boolean;
}

export interface SwimInput {
  /** The liquid's surface over the capsule. */
  surfaceY: number;
  /** Which liquid: its walk and slope multipliers (SURFACE_MOVEMENT) apply from the feet under the
   *  surface, and its LIQUID_VISCOSITY thickens the swim (physics/movement-modifiers/constants.ts). */
  liquid: LiquidKind;
  /** The jump key went down this step (not merely held). */
  jumpPressed: boolean;
}

export interface CharacterInput {
  dirX: number;
  dirZ: number;
  speed: number;
  jump: boolean;
  /** Caller drives vy this step (NPC ascend, a manhole climb); gravity, fall clamp and jump are skipped. */
  vyOverride?: number | null;
  /** A liquid over the capsule (unset = none): it wades from the feet under, swims once SWIM_SUBMERGED_FRACTION of it is. */
  swim?: SwimInput | null;
  /** The terrain heightfields (markTerrainCollider) are neither ground nor obstacle this step: a
   *  player in a tunnel under them (player/hooks.ts). */
  ignoreTerrain?: boolean;
  /** What the ground under the capsule does to its walk and its grip (physics/movement-modifiers/index.ts: the snow;
   *  unset = neutral). Sampled by the CALLER on a worker (`surfaceModifiersAt`) and
   *  handed in: evaluating it on the stepping thread runs the height pipeline at the capsule, and a cold
   *  cell there costs 250–385ms (physics/DECISIONS.md). */
  surface?: MovementModifiers | null;
}

/** Positions are the body CENTER after the solve. */
export interface CharacterStepResult {
  x: number;
  y: number;
  z: number;
  grounded: boolean;
  /** Ray says the capsule stands on ground ≤ the slide angle. */
  walkableSupport: boolean;
  nearGround: boolean;
  /** Radians; 0 when no ground probed. */
  groundAngle: number;
  onSlideSlope: boolean;
  /** Under water this step (the vertical motion was the swim's). */
  swimming: boolean;
  /** Horizontal DESIRED translation this step — for the caller's stuck detection. */
  desiredX: number;
  desiredZ: number;
}

export interface RapierRuntime {
  Ray: new (origin: Rapier.Vector, dir: Rapier.Vector) => Rapier.Ray;
}

export interface Character {
  controller: Rapier.KinematicCharacterController;
  ray: Rapier.Ray;
  shape: CharacterShape;
  state: CharacterMotionState;
  /** The slide angle the controller was last set to (the surface's traction moves it; applySlopeLimits). */
  slideAngle: number;
}
