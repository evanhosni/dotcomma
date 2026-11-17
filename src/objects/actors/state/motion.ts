import type { MotionOutput, MotionParams, Vec3Like } from "./types";
import { createMotionOutput, stepAngle, angleDiffAbs } from "./utils";
import { DEFAULT_MOTION_PARAMS } from "./defaults";

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

export class Motion {
  /** Read by the mover/publisher: what the behavior asked for, scaled by the params (zero while paused). */
  readonly out: MotionOutput = createMotionOutput();
  private readonly requested = createMotionOutput();
  private readonly params: MotionParams;
  private paused = false;

  constructor(
    private readonly position: { current: Vec3Like },
    params: Partial<MotionParams> = {},
  ) {
    this.params = {
      speed: params.speed ?? DEFAULT_MOTION_PARAMS.speed,
      turnSpeed: params.turnSpeed ?? DEFAULT_MOTION_PARAMS.turnSpeed,
    };
  }

  /** Horizontal velocity; the vertical channel is left as it was. */
  move(vx: number, vz: number): this {
    this.requested.vx = vx;
    this.requested.vz = vz;
    return this.applyVelocity();
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
    this.requested.vy = vy;
    return this.applyVelocity();
  }

  /** Zero horizontal velocity and hand the vertical back to gravity. */
  stop(): this {
    this.requested.vx = 0;
    this.requested.vz = 0;
    this.requested.vy = null;
    return this.applyVelocity();
  }

  setSpeed(speed: number): this {
    this.params.speed = Math.max(0, speed);
    return this.applyVelocity();
  }

  setTurnSpeed(turnSpeed: number): this {
    this.params.turnSpeed = Math.max(0, turnSpeed);
    return this;
  }

  /** Holds the body (a flyer hovers) and its turning; the behavior's requests are kept for `resume`. */
  pause(): this {
    this.paused = true;
    return this.applyVelocity();
  }

  resume(): this {
    this.paused = false;
    return this.applyVelocity();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  face(yaw: number): this {
    this.out.yaw = yaw;
    return this;
  }

  /** No-op while not moving horizontally. */
  faceHeading(): this {
    const { vx, vz } = this.requested;
    if (vx * vx + vz * vz > 1e-8) this.out.yaw = Math.atan2(vx, vz);
    return this;
  }

  faceToward(x: number, z: number): this {
    return this.face(this.angleTo(x, z));
  }

  /** Call per tick with rate × dt (scaled by `turnSpeed`; held while paused). */
  turnTo(yaw: number, maxStep: number): this {
    if (!this.paused) this.out.yaw = stepAngle(this.out.yaw, yaw, maxStep * this.params.turnSpeed);
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

  private applyVelocity(): this {
    const scale = this.paused ? 0 : this.params.speed;
    const { vx, vy, vz } = this.requested;
    this.out.vx = vx * scale;
    this.out.vz = vz * scale;
    this.out.vy = vy === null ? (this.paused ? 0 : null) : vy * scale;
    return this;
  }
}
