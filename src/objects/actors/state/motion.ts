/**
 * MOTION — how a state machine moves and turns its actor.
 *
 * A behavior never writes a transform. It describes what it WANTS through
 * `ctx.motion` — a horizontal velocity, an optional driven vertical velocity,
 * a facing — and the framework applies it: on the SERVER the shared character
 * resolver moves the body and publishes the result; on a LOCAL
 * (`serverSynced={false}`) actor the kinematic mover does the same thing on
 * the client. No Three.js here: this runs in Node.
 *
 * Velocities are world units per second. `vy === null` means "let the body
 * fall/stand on the ground" (ground movers); a number DRIVES the vertical
 * (ascending, flying). For `movement: "free"` actors null simply means 0.
 * Facing (`yaw`) is three.js `rotation.y`: local +Z faces the view direction,
 * so a heading angle θ moves along (sin θ, cos θ) — `heading()` and `face()`
 * use the same convention, which is why `faceHeading()` is a plain copy.
 */

export interface MotionOutput {
  vx: number;
  /** Driven vertical velocity, or null = gravity / ground following. */
  vy: number | null;
  vz: number;
  /** Facing, radians (three.js rotation.y). */
  yaw: number;
}

/** Anything with x/y/z — THREE.Vector3 on the client, a plain object on the server. */
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

/** Absolute shortest-arc difference between two angles. */
export const angleDiffAbs = (a: number, b: number): number => Math.abs(wrapAngle(b - a));

/** Shortest-arc interpolation; `t` is clamped to [0, 1]. */
export const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * Math.min(Math.max(t, 0), 1);

/** Step from `a` toward `b` by at most `maxStep` radians along the shortest arc. */
export const stepAngle = (a: number, b: number, maxStep: number): number => {
  const d = wrapAngle(b - a);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
};

export class Motion {
  /** The outputs the framework applies. Read by the mover/publisher; behaviors
   *  use the methods instead of writing these directly. */
  readonly out: MotionOutput = createMotionOutput();

  constructor(private readonly position: { current: Vec3Like }) {}

  // ── movement ──────────────────────────────────────────────────────────────

  /** Horizontal velocity (u/s). The vertical channel is left as it was. */
  move(vx: number, vz: number): this {
    this.out.vx = vx;
    this.out.vz = vz;
    return this;
  }

  /** Move along a heading angle (radians, same convention as facing) at `speed`. */
  heading(angle: number, speed: number): this {
    return this.move(speed * Math.sin(angle), speed * Math.cos(angle));
  }

  /** Move toward a world (x, z) at `speed`; stops if already within `arrive`. */
  toward(x: number, z: number, speed: number, arrive = 0): this {
    const dx = x - this.position.current.x;
    const dz = z - this.position.current.z;
    const d = Math.hypot(dx, dz);
    if (d <= arrive || d < 1e-6) return this.move(0, 0);
    return this.move((dx / d) * speed, (dz / d) * speed);
  }

  /** Drive the vertical velocity (ascend, fly); null = gravity / ground. */
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

  // ── facing ────────────────────────────────────────────────────────────────

  face(yaw: number): this {
    this.out.yaw = yaw;
    return this;
  }

  /** Face the direction of travel (no-op while not moving horizontally). */
  faceHeading(): this {
    const { vx, vz } = this.out;
    if (vx * vx + vz * vz > 1e-8) this.out.yaw = Math.atan2(vx, vz);
    return this;
  }

  faceToward(x: number, z: number): this {
    return this.face(this.angleTo(x, z));
  }

  /** Turn toward `yaw` by at most `maxStep` radians (call per tick with rate × dt). */
  turnTo(yaw: number, maxStep: number): this {
    this.out.yaw = stepAngle(this.out.yaw, yaw, maxStep);
    return this;
  }

  turnToward(x: number, z: number, maxStep: number): this {
    return this.turnTo(this.angleTo(x, z), maxStep);
  }

  // ── queries ───────────────────────────────────────────────────────────────

  /** Heading angle from the actor to a world (x, z). */
  angleTo(x: number, z: number): number {
    return Math.atan2(x - this.position.current.x, z - this.position.current.z);
  }

  /** How far (shortest arc) the actor's facing is from pointing at (x, z). */
  facingErrorTo(x: number, z: number): number {
    return angleDiffAbs(this.out.yaw, this.angleTo(x, z));
  }

  get yaw(): number {
    return this.out.yaw;
  }

  /** Horizontal speed (u/s). */
  get speed(): number {
    return Math.hypot(this.out.vx, this.out.vz);
  }

  get moving(): boolean {
    return this.out.vx !== 0 || this.out.vz !== 0 || (this.out.vy !== null && this.out.vy !== 0);
  }
}
