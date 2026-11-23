export interface TunnelState {
  inside: boolean;
  exitSteps: number;
  /** Seconds since last inside (Infinity: never). */
  outsideFor: number;
  holding: boolean;
  /** The manhole column the body stands in, by id. */
  column: string | null;
  /** On the column's ladder. */
  onLadder: boolean;
  /** Pushed out from the ladder after a jump off, until the hop falls back under `pushFromFeet`. */
  pushingOff: boolean;
  pushFromFeet: number;
}

export interface TunnelStep {
  ignoreTerrain: boolean;
  vyOverride: number | null;
  /** Walking is held still (a manhole's catch). */
  holdWalk: boolean;
  /** The sewage level over the capsule (a tunnel's only liquid), or NaN. */
  sewageY: number;
  /** Move the body's CENTER here before the step (a manhole's catch or exit, a backstop); NaN x: stay. */
  teleportX: number;
  teleportY: number;
  teleportZ: number;
  /** The character's own motion is to be reset (a manhole's exit). */
  resetMotion: boolean;
  /** A horizontal velocity (u/s) that replaces the walk this step (a jump off a ladder); 0, 0: none. */
  pushX: number;
  pushZ: number;
}

/** A climbable ladder as the rules see it (climbLadder); any ladder placement builds one (a manhole's:
 *  manholeLadder). Its default is the climb onto whatever it leads to: past its top by a clearance. */
export interface Ladder {
  /** The middle of its face at the bottom, and the way a climber faces it (toward the wall). */
  x: number;
  z: number;
  faceX: number;
  faceZ: number;
  halfWidth: number;
  bottomY: number;
  /** Where it ends: the feet climb to a clearance over this, and the walk steps off there. */
  topY: number;
  /** A ceiling over it (a closed cover): the climb stops with the head under it; NaN: none. */
  ceilingY: number;
  /** The feet's landing for a jump near the top (a vault out); NaN x: a jump only lets go. */
  exitX: number;
  exitY: number;
  exitZ: number;
}

/** The capsule as the rules see it: its CENTER, its shape, whether jump is held, and its walk direction
 *  (any length; a ladder is grabbed by walking at it). A server NPC never jumps and its walk is not
 *  passed, so it never climbs. */
export interface TunnelBody {
  x: number;
  y: number;
  z: number;
  height: number;
  radius: number;
  jump: boolean;
  moveX: number;
  moveZ: number;
}
