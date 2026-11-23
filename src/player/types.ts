import type { Character, CharacterStepResult } from "../physics/types";
import type { CameraWaterColors } from "../vfx/screen-pass/types";

export interface GroundSafetyNets {
  /** Stuck escape: a capsule slightly embedded (under the backstop tolerance, e.g. after a LOD swap)
   *  makes every sweep return ~zero. Signal = sustained input with ~no movement; confirmed against the
   *  analytic height so a wall push never triggers it. Call after every walking step. */
  escapeIfStuck(step: CharacterStepResult, from: { x: number; z: number }, character: Character): void;
  /** Authoritative anti-tunneling backstop, every GROUND_CHECK_INTERVAL frames (skipped mid fall reset). */
  runBackstop(at: { x: number; y: number; z: number }, character: Character): void;
  /** Fell out of the world: drop back in above the ground here. */
  respawnIfFallen(at: { x: number; y: number; z: number }, character: Character): void;
}

export interface InputState {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  jump: boolean;
  /** Descend in noclip. */
  descend: boolean;
}

export interface WaterProbe {
  /** Starts a sample at (x, z) every PROBE_INTERVAL_FRAMES (one in flight at a time). */
  sample(x: number, z: number): void;
  /** The last sampled water surface over a point at height `y`, or NaN where no water stands above the
   *  ground or the point is under its bed (a tunnel under a river is not in it). */
  surfaceOver(y: number): number;
  /** The colours of the last sampled water, its owning bodies' blended as the sheet draws them there. */
  colors(): CameraWaterColors;
  clear(): void;
}

/** What the player did this frame, as far as its animation cares (utils.ts, playerAnimationOf). */
export interface PlayerActionSample {
  noclip: boolean;
  swimming: boolean;
  /** Off the ground and not about to touch it. */
  airborne: boolean;
  sliding: boolean;
  climbing: boolean;
  /** Left the ground by jumping (cleared on landing). */
  jumped: boolean;
  vy: number;
  /** Horizontal u/s. */
  speed: number;
  /** Standing, the body turning in place toward the look. */
  turningInPlace: boolean;
  sprint: boolean;
}

/** Written by Player.tsx each frame, drawn by PlayerBody.tsx. */
export interface PlayerBodyState {
  feetX: number;
  feetY: number;
  feetZ: number;
  yaw: number;
  /** The head bone's yaw from the body and its pitch (+ = up) (HEAD_TURN_LAYER); undefined = the clip's. */
  headYaw: number | undefined;
  headPitch: number | undefined;
  clip: string;
  clipSpeed: number;
  loop: "repeat" | "once";
  /** False in first person: the camera is inside the head. */
  visible: boolean;
}

export type ScreenSide = "left" | "right";
