/**
 * THE VEHICLE: a ray-cast car on a dynamic Rapier body. Every force is an impulse at a contact
 * patch, so weight transfer, body roll, drifts, jumps and crashes come from the rigid body itself;
 * the arcade part (GTA's feel) is only in the tire model's numbers: speed-sensitive steering, a
 * handbrake that unloads the rear grip, and air control. Three-free and React-free (Rapier types
 * only) like the character resolver, so the server can bundle it.
 */
import type Rapier from "@dimforge/rapier3d-compat";
import { clamp, lerp, smoothstep } from "../../utils/math";
import type { RapierRuntime, Vehicle, VehicleInput, VehicleShape, VehicleState, VehicleStats } from "./types";
import {
  AIR_DRAG,
  AIR_PITCH,
  AIR_STEER,
  COAST_DECEL,
  DAMPING_RATIO,
  DOWNFORCE,
  FREE_WHEEL_SPIN,
  FLIP_RESET_LIFT,
  FLIP_RESET_SECONDS,
  FLIP_STILL_SPEED,
  FLIPPED_UP_DOT,
  GRIP_BASE,
  GRIP_HANDLING_RANGE,
  HANDBRAKE_DECEL,
  HANDBRAKE_GRIP,
  LATERAL_STIFFNESS,
  MAX_DAMPING_PER_STEP,
  MAX_SPRING_LOAD,
  MAX_STEER_FAST,
  MAX_STEER_SLOW,
  MAX_STEP_SECONDS,
  MIN_STEP_SECONDS,
  OFFROAD_DRAG,
  OFFROAD_GRIP_MIN,
  OFFROAD_SPEED_MIN,
  REAR_GRIP,
  REVERSE_ACCEL_RATIO,
  REVERSE_SPEED_RATIO,
  REVERSE_SWITCH_SPEED,
  ROLL_REDUCTION,
  SPRING_RATE,
  STEER_RATE,
  STEER_RETURN_RATE,
} from "./constants";

export const NO_VEHICLE_INPUT: Readonly<VehicleInput> = { throttle: 0, steer: 0, handbrake: false };
/** An empty car holds its parking brake: bumped, it skids to a stop instead of rolling away. */
export const PARKED_VEHICLE_INPUT: Readonly<VehicleInput> = { throttle: 0, steer: 0, handbrake: true };

const GRAVITY_MAGNITUDE = 100;

export const createVehicleState = (shape: VehicleShape): VehicleState => ({
  steer: 0,
  wheels: shape.wheels.map(() => ({ suspension: shape.suspensionLength, compression: 0, grounded: false, spin: 0 })),
  groundedWheels: 0,
  forwardSpeed: 0,
  onRoad: true,
  flippedFor: 0,
});

export const createVehicle = (rapier: RapierRuntime, body: Rapier.RigidBody, shape: VehicleShape, stats: VehicleStats): Vehicle => ({
  body,
  shape,
  stats,
  state: createVehicleState(shape),
  ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
});

// ─── scratch vector math (plain objects: Rapier copies on every call) ───────────────────────────
interface V3 {
  x: number;
  y: number;
  z: number;
}
const v3 = (): V3 => ({ x: 0, y: 0, z: 0 });
const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const setV = (o: V3, x: number, y: number, z: number): V3 => {
  o.x = x;
  o.y = y;
  o.z = z;
  return o;
};
const cross = (a: V3, b: V3, o: V3): V3 => setV(o, a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const normalize = (o: V3): V3 => {
  const l = Math.hypot(o.x, o.y, o.z) || 1;
  return setV(o, o.x / l, o.y / l, o.z / l);
};
/** `v` rotated by the unit quaternion `q`, into `o`. */
const rotate = (q: Rapier.Rotation, vx: number, vy: number, vz: number, o: V3): V3 => {
  const tx = 2 * (q.y * vz - q.z * vy);
  const ty = 2 * (q.z * vx - q.x * vz);
  const tz = 2 * (q.x * vy - q.y * vx);
  return setV(o, vx + q.w * tx + (q.y * tz - q.z * ty), vy + q.w * ty + (q.z * tx - q.x * tz), vz + q.w * tz + (q.x * ty - q.y * tx));
};

const _up = v3();
const _fwd = v3();
const _right = v3();
const _mount = v3();
const _contact = v3();
const _apply = v3();
const _wheelFwd = v3();
const _wheelRight = v3();
const _pointVel = v3();
const _arm = v3();
const _spinVel = v3();
const _impulse = v3();
const _torque = v3();
const _down = v3();

/** Never a sensor, never the car's own body (the ray starts inside its hull). */
const _solid = (c: Rapier.Collider): boolean => !c.isSensor();

/** The longitudinal input as (drive −1..1, brake 0..1): S brakes a car rolling forward and reverses a
 *  stopped one, and W the other way round. */
const resolvePedals = (throttle: number, forwardSpeed: number): { drive: number; brake: number } => {
  if (throttle > 0) return forwardSpeed < -REVERSE_SWITCH_SPEED ? { drive: 0, brake: throttle } : { drive: throttle, brake: 0 };
  if (throttle < 0) return forwardSpeed > REVERSE_SWITCH_SPEED ? { drive: 0, brake: -throttle } : { drive: throttle, brake: 0 };
  return { drive: 0, brake: 0 };
};

/** Engine pull, u/s²: full from a standstill, fading to nothing at the (surface's) top speed. */
const enginePull = (stats: VehicleStats, drive: number, forwardSpeed: number, speedScale: number): number => {
  if (drive === 0) return 0;
  const reverse = drive < 0;
  const top = stats.topSpeed * speedScale * (reverse ? REVERSE_SPEED_RATIO : 1);
  const ratio = clamp((reverse ? -forwardSpeed : forwardSpeed) / top, 0, 1);
  return drive * stats.acceleration * (reverse ? REVERSE_ACCEL_RATIO : 1) * (1 - ratio ** 2.2);
};

/** Turns the steered wheels toward the input, by less the faster the car goes. */
const steerToward = (state: VehicleState, stats: VehicleStats, steer: number, dt: number): void => {
  const speedRatio = clamp(Math.abs(state.forwardSpeed) / stats.topSpeed, 0, 1);
  const lock = lerp(MAX_STEER_SLOW, MAX_STEER_FAST, smoothstep(0, 0.8, speedRatio)) * (0.8 + 0.4 * stats.handling);
  const target = steer * lock;
  const returning = Math.abs(target) < Math.abs(state.steer) || Math.sign(target) !== Math.sign(state.steer);
  const rate = (returning ? STEER_RETURN_RATE : STEER_RATE) * (0.8 + 0.4 * stats.handling);
  const delta = target - state.steer;
  state.steer += clamp(delta, -rate * dt, rate * dt);
};

/** Rights a car left on its roof. */
const recoverIfFlipped = (vehicle: Vehicle, dt: number, speed: number): void => {
  const { body, state } = vehicle;
  if (_up.y > FLIPPED_UP_DOT || speed > FLIP_STILL_SPEED) {
    state.flippedFor = 0;
    return;
  }
  state.flippedFor += dt;
  if (state.flippedFor < FLIP_RESET_SECONDS) return;
  state.flippedFor = 0;
  const yaw = Math.atan2(_fwd.x, _fwd.z);
  const t = body.translation();
  body.setTranslation({ x: t.x, y: t.y + FLIP_RESET_LIFT, z: t.z }, true);
  body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
};

/**
 * One physics step of one car, called BEFORE the world steps (its impulses ride that step).
 * `dt` is the step's length. A sleeping body is left asleep.
 */
export const stepVehicle = (world: Rapier.World, vehicle: Vehicle, input: VehicleInput, dt: number): void => {
  const { body, shape, stats, state, ray } = vehicle;
  if (body.isSleeping()) return;
  const h = clamp(dt, MIN_STEP_SECONDS, MAX_STEP_SECONDS);
  const awake = input.throttle !== 0 || input.steer !== 0;

  const t = body.translation();
  const q = body.rotation();
  const lv = body.linvel();
  const av = body.angvel();
  const com = body.worldCom();
  const mass = body.mass();
  const share = mass / shape.wheels.length;

  rotate(q, 0, 1, 0, _up);
  rotate(q, 0, 0, 1, _fwd);
  rotate(q, -1, 0, 0, _right);
  setV(_down, -_up.x, -_up.y, -_up.z);

  state.forwardSpeed = dot(lv, _fwd);
  const speed = Math.hypot(lv.x, lv.y, lv.z);
  steerToward(state, stats, input.steer, h);

  const offRoad = !state.onRoad;
  const speedScale = offRoad ? lerp(OFFROAD_SPEED_MIN, 1, stats.offRoad) : 1;
  const surfaceGrip = offRoad ? lerp(OFFROAD_GRIP_MIN, 1, stats.offRoad) : 1;
  const mu = (GRIP_BASE + GRIP_HANDLING_RANGE * stats.handling) * surfaceGrip;
  const { drive, brake } = resolvePedals(input.throttle, state.forwardSpeed);
  const pull = enginePull(stats, drive, state.forwardSpeed, speedScale);

  let driven = 0;
  for (let i = 0; i < shape.wheels.length; i++) {
    const wheel = shape.wheels[i];
    if (wheel.driven && state.wheels[i].grounded) driven++;
  }
  if (driven === 0) driven = shape.wheels.filter((w) => w.driven).length || 1;

  const damping = Math.min(2 * DAMPING_RATIO * Math.sqrt(SPRING_RATE), MAX_DAMPING_PER_STEP / h);
  const reach = shape.suspensionLength;
  let grounded = 0;

  for (let i = 0; i < shape.wheels.length; i++) {
    const wheel = shape.wheels[i];
    const ws = state.wheels[i];
    rotate(q, wheel.x, wheel.y, wheel.z, _mount);
    _mount.x += t.x;
    _mount.y += t.y;
    _mount.z += t.z;

    ray.origin = _mount;
    ray.dir = _down;
    const hit = world.castRayAndGetNormal(ray, reach + wheel.radius, true, undefined, undefined, undefined, body, _solid);
    const prevCompression = ws.compression;
    if (!hit) {
      ws.grounded = false;
      ws.compression = 0;
      ws.suspension = reach;
      if (wheel.driven) ws.spin += drive * FREE_WHEEL_SPIN * h;
      continue;
    }
    grounded++;
    ws.grounded = true;
    ws.suspension = Math.max(0, hit.timeOfImpact - wheel.radius);
    ws.compression = reach - ws.suspension;

    // ── suspension: a spring along the body's up axis, through the contact patch
    const compressionSpeed = (ws.compression - prevCompression) / h;
    const load = clamp(SPRING_RATE * ws.compression + damping * compressionSpeed, 0, MAX_SPRING_LOAD * GRAVITY_MAGNITUDE) * share;
    setV(_contact, _mount.x + _down.x * hit.timeOfImpact, _mount.y + _down.y * hit.timeOfImpact, _mount.z + _down.z * hit.timeOfImpact);
    body.applyImpulseAtPoint(setV(_impulse, _up.x * load * h, _up.y * load * h, _up.z * load * h), _contact, false);

    // ── the tire: its rolling and side axes on the ground it touches
    const n = hit.normal;
    const steer = wheel.steers ? state.steer : 0;
    const cs = Math.cos(steer);
    const sn = Math.sin(steer);
    setV(_wheelFwd, _fwd.x * cs + _right.x * sn, _fwd.y * cs + _right.y * sn, _fwd.z * cs + _right.z * sn);
    const along = dot(_wheelFwd, n);
    normalize(setV(_wheelFwd, _wheelFwd.x - n.x * along, _wheelFwd.y - n.y * along, _wheelFwd.z - n.z * along));
    normalize(cross(_wheelFwd, n, _wheelRight));

    setV(_arm, _contact.x - com.x, _contact.y - com.y, _contact.z - com.z);
    cross(av, _arm, _spinVel);
    setV(_pointVel, lv.x + _spinVel.x, lv.y + _spinVel.y, lv.z + _spinVel.z);
    const rolling = dot(_pointVel, _wheelFwd);
    const slip = dot(_pointVel, _wheelRight);
    ws.spin += (rolling / wheel.radius) * h;

    const locked = wheel.rear && input.handbrake;
    const sideGrip = locked ? HANDBRAKE_GRIP : wheel.rear ? REAR_GRIP : 1;
    let lateral = -slip * share * LATERAL_STIFFNESS * sideGrip;

    // Each term stops at zero speed rather than pushing back the other way.
    const stopping = (decel: number): number => -Math.sign(rolling) * Math.min(Math.abs(rolling) * share, decel * share * h);
    let longitudinal = 0;
    if (wheel.driven) longitudinal += (pull * mass * h) / driven;
    if (brake > 0) longitudinal += stopping(stats.braking * brake);
    if (locked) longitudinal += stopping(HANDBRAKE_DECEL);
    if (drive === 0 && brake === 0) longitudinal += stopping(COAST_DECEL + (offRoad ? OFFROAD_DRAG * (1 - stats.offRoad) * Math.abs(rolling) : 0));

    // The friction circle: past it the tire slides, and a sliding tire loses side grip first (the drift).
    const limit = mu * load * h * (locked ? 0.7 : 1);
    const total = Math.hypot(lateral, longitudinal);
    if (total > limit && total > 0) {
      const k = limit / total;
      lateral *= k;
      longitudinal *= k;
    }

    // Applied part-way up toward the center of mass: less roll than the contact patch would give.
    const lift = dot(setV(_apply, com.x - _contact.x, com.y - _contact.y, com.z - _contact.z), _up) * ROLL_REDUCTION;
    setV(_apply, _contact.x + _up.x * lift, _contact.y + _up.y * lift, _contact.z + _up.z * lift);
    setV(
      _impulse,
      _wheelFwd.x * longitudinal + _wheelRight.x * lateral,
      _wheelFwd.y * longitudinal + _wheelRight.y * lateral,
      _wheelFwd.z * longitudinal + _wheelRight.z * lateral,
    );
    body.applyImpulseAtPoint(_impulse, _apply, false);
  }
  state.groundedWheels = grounded;

  // ── aero: drag always, downforce on the ground
  const drag = AIR_DRAG * speed * mass * h;
  body.applyImpulse(setV(_impulse, -lv.x * drag, -lv.y * drag, -lv.z * drag), false);
  if (grounded > 0) {
    const press = DOWNFORCE * speed * mass * h;
    body.applyImpulse(setV(_impulse, _down.x * press, _down.y * press, _down.z * press), false);
  } else {
    // ── air control: yaw on the steering keys, pitch on the pedals (W noses down). Right-handed: +y
    // yaw turns the nose left, + about the right axis lifts it.
    const yaw = -input.steer * AIR_STEER * mass * h;
    const pitch = -input.throttle * AIR_PITCH * mass * h;
    setV(_torque, _up.x * yaw + _right.x * pitch, _up.y * yaw + _right.y * pitch, _up.z * yaw + _right.z * pitch);
    body.applyTorqueImpulse(_torque, false);
  }

  recoverIfFlipped(vehicle, h, speed);
  if (awake) body.wakeUp();
};
