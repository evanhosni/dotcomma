export interface TunnelState {
  inside: boolean;
  exitSteps: number;
  /** Seconds since last inside (Infinity: never). */
  outsideFor: number;
  holding: boolean;
  /** The manhole column the body stands in, by id. */
  column: string | null;
}

export interface TunnelStep {
  ignoreTerrain: boolean;
  vyOverride: number | null;
  /** Walking is held still (a manhole's catch). */
  holdWalk: boolean;
  /** The liquid level over the capsule (a tunnel's liquid is the sewers' sewage), or NaN, and its
   *  viscosity relative to water. */
  liquidY: number;
  liquidViscosity: number;
  /** Move the body's CENTER here before the step (a manhole's catch or exit, a backstop); NaN x: stay. */
  teleportX: number;
  teleportY: number;
  teleportZ: number;
  /** The character's own motion is to be reset (a manhole's exit). */
  resetMotion: boolean;
}

/** The capsule as the rules see it: its CENTER, its shape, and whether jump is held (an NPC never). */
export interface TunnelBody {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  jump: boolean;
}
