/**
 * How a state machine moves and turns its actor: a behavior describes what it
 * wants through `ctx.motion` and the framework applies it (the server's character
 * resolver, or the client's kinematic mover for local actors). No Three.js.
 *
 * Velocities are world units per second. `vy === null` = "stand on the ground"
 * (a number DRIVES the vertical; for `movement: "free"` null means 0). `yaw` is
 * three.js `rotation.y`: local +Z faces the view direction, so a heading θ moves
 * along (sin θ, cos θ) — the same convention as facing.
 */

export interface MotionOutput {
  vx: number;
  vy: number | null;
  vz: number;
  yaw: number;
}

/** THREE.Vector3 on the client, a plain object on the server. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const createMotionOutput = (): MotionOutput => ({ vx: 0, vy: null, vz: 0, yaw: 0 });

export const copyMotionOutput = (from: MotionOutput, to: MotionOutput): void => {
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
};

/** Wrap to (−π, π]. */
export const wrapAngle = (a: number): number => {
  let d = a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

export const angleDiffAbs = (a: number, b: number): number => Math.abs(wrapAngle(b - a));

/** Shortest-arc interpolation; `t` clamped to [0, 1]. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * Math.min(Math.max(t, 0), 1);

/** Step from `a` toward `b` by at most `maxStep` radians along the shortest arc. */
export const stepAngle = (a: number, b: number, maxStep: number): number => {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};

export class Motion {
  /** Read by the mover/publisher; behaviors use the methods. */
  readonly out: MotionOutput = createMotionOutput();

  constructor(private readonly position: { current: Vec3Like }) {}

  /** Horizontal velocity; the vertical channel is left as it was. */
  move(vx: number, vz: number): this {
    this.out.vx = vx;
    this.out.vz = vz;
    return this;
  }

  heading(angle: number, speed: number): this {
    return this.move(speed * Math.sin(angle), speed * Math.cos(angle));
  }

  /** Stops if already within `arrive`. */
  toward(x: number, z: number, speed: number, arrive = 0): this {
    const dx = x - this.position.current.x;
    const dz = z - this.position.current.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive || d < 1e-6) return this.move(0, 0);
    return this.move((dx / d) * speed, (dz / d) * speed);
  }

  /** Drive the vertical velocity; null = gravity / ground. */
  fly(vy: number | null): this {
    this.out.vy = vy;
    return this;
  }

  /** Zero horizontal velocity and hand the vertical back to gravity. */
  stop(): this {
    this.out.vx = 0;
    this.out.vz = 0;
    this.out.vy = null;
    return this;
  }

  face(yaw: number): this {
    this.out.yaw = yaw;
    return this;
  }

  /** No-op while not moving horizontally. */
  faceHeading(): this {
    const { vx, vz } = this.out;
    if (vx * vx + vz * vz > 1e-8) this.out.yaw = Math.atan2(vx, vz);
    return this;
  }

  faceToward(x: number, z: number): this {
    return this.face(this.angleTo(x, z));
  }

  /** Call per tick with rate × dt. */
  turnTo(yaw: number, maxStep: number): this {
    this.out.yaw = stepAngle(this.out.yaw, yaw, maxStep);
    return this;
  }

  turnToward(x: number, z: number, maxStep: number): this {
    return this.turnTo(this.angleTo(x, z), maxStep);
  }

  angleTo(x: number, z: number): number {
    return Math.atan2(x - this.position.current.x, z - this.position.current.z);
  }

  facingErrorTo(x: number, z: number): number {
    return angleDiffAbs(this.out.yaw, this.angleTo(x, z));
  }

  get yaw(): number {
    return this.out.yaw;
  }

  get speed(): number {
    return Math.hypot(this.out.vx, this.out.vz);
  }

  get moving(): boolean {
    return this.out.vx !== 0 || this.out.vz !== 0 || (this.out.vy !== null && this.out.vy !== 0);
  }
}
