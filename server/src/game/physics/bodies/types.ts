

export interface Pose {
  x: number;
  /** Feet. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface NpcBody {
  /** Feet. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Everything this body needs exists — it may move. */
  readonly ready: boolean;
  step(dt: number, vx: number, vz: number, vy: number | null): void;
  resolvePose(dt: number, out: Pose): Pose;
  dispose(): void;
}

export interface PlayerPose {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface CapsuleShape {
  radius: number;
  /** Feet to top. */
  height: number;
}
