/**
 * THE movement resolver for every kinematic capsule (local player + server
 * NPCs): tune here, nowhere else. No Three, no React (of Rapier, types only),
 * because the server's esbuild bundle runs this file. The measurements behind the
 * constants are in CLAUDE.md (player/Player.tsx).
 */
import type Rapier from "@dimforge/rapier3d-compat";
import { smoothstep } from "../utils/math";
import { LIQUID_VISCOSITY, MAX_SLIDE_ANGLE, SURFACE_MOVEMENT } from "./movement-modifiers/constants";
import type { CharacterMotionState, RapierRuntime, CharacterShape, Character, CharacterInput, SwimInput, CharacterStepResult } from "./types";
import { CONTROLLER_CONTACT_OFFSET, SLOPE_SLIDE_ANGLE, SNAP_TO_GROUND, SLOPE_SOFT_START, SLOPE_SOFT_END, SLOPE_TIMER_DECAY, GROUND_RAY_LENGTH, GROUND_RAY_SLACK, SLOPE_ENGAGE_DELAY, SLIDE_STOP_DECEL, SLIDE_MAX_SPEED, GRAVITY, TERMINAL_VELOCITY, NEAR_GROUND_FALL_SPEED_CAP, JUMP_IMPULSE, SWIM_SUBMERGED_FRACTION, SWIM_BREACH_REACH, SWIM_BREACH_IMPULSE, SWIM_SINK_SPEED, WATER_DRAG, SWIM_STROKE_IMPULSE, SWIM_HEAD_ABOVE_SURFACE, SWIM_SINK_ACCEL, MAX_SUBSTEPS, MAX_SUBSTEP_DISTANCE, SLIDE_ENGAGE_DELAY, GROUND_EMBED_TOLERANCE, GROUND_EMBED_RECOVERY, MAX_MOVEMENT_PER_FRAME, CEILING_BLOCKED_FRACTION, SUPPORT_REST_GAP } from "./constants";

export const createCharacterMotionState = (): CharacterMotionState => ({
  vy: 0,
  slideSpeed: 0,
  slideDirX: 0,
  slideDirY: 0,
  slideDirZ: 0,
  softSlopeTime: 0,
  steepSlopeTime: 0,
  breaching: false,
});

export const resetCharacterMotion = (s: CharacterMotionState): void => {
  s.vy = 0;
  s.slideSpeed = 0;
  s.breaching = false;
};

export const createCharacterController = (world: Rapier.World): Rapier.KinematicCharacterController => {
  const controller = world.createCharacterController(CONTROLLER_CONTACT_OFFSET);
  controller.setMaxSlopeClimbAngle(SLOPE_SLIDE_ANGLE + 0.01);
  controller.setMinSlopeSlideAngle(SLOPE_SLIDE_ANGLE);
  // Default 1e-4 let shallow penetrations accumulate until a sweep started inside the trimesh.
  controller.setNormalNudgeFactor(0.02);
  controller.enableSnapToGround(SNAP_TO_GROUND);
  controller.enableAutostep(0.5, 0.2, true);
  controller.setApplyImpulsesToDynamicBodies(true);
  return controller;
};

export const createCharacter = (rapier: RapierRuntime, world: Rapier.World, shape: CharacterShape): Character => ({
  controller: createCharacterController(world),
  ray: new rapier.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }),
  shape,
  state: createCharacterMotionState(),
  slideAngle: SLOPE_SLIDE_ANGLE,
});

/** A swimmer's slope limits: no ground reaches them, so the water alone moves it (no slide, no uphill
 *  fade, and the Rapier climb wall lifted so a stroke into a steep bank glides up it). */
const NO_SLOPE_LIMIT = Math.PI / 2;

/** The step's slope limits: the constants times the ground's slope factor (physics/movement-modifiers/constants.ts). */
const _slopes = { softStart: SLOPE_SOFT_START, softEnd: SLOPE_SOFT_END, slide: SLOPE_SLIDE_ANGLE };
const applySlopeLimits = (c: Character, slopeFactor: number, swimming: boolean): typeof _slopes => {
  const k = Math.min(slopeFactor, MAX_SLIDE_ANGLE / SLOPE_SLIDE_ANGLE);
  _slopes.softStart = swimming ? NO_SLOPE_LIMIT : SLOPE_SOFT_START * k;
  _slopes.softEnd = swimming ? NO_SLOPE_LIMIT : SLOPE_SOFT_END * k;
  _slopes.slide = swimming ? NO_SLOPE_LIMIT : SLOPE_SLIDE_ANGLE * k;
  // The controller's own climb wall follows the slide angle; two wasm calls, only when it moved.
  if (Math.abs(_slopes.slide - c.slideAngle) > 1e-4) {
    c.slideAngle = _slopes.slide;
    c.controller.setMaxSlopeClimbAngle(_slopes.slide + 0.01);
    c.controller.setMinSlopeSlideAngle(_slopes.slide);
  }
  return _slopes;
};

export const disposeCharacter = (world: Rapier.World, c: Character): void => {
  world.removeCharacterController(c.controller);
};

// Rapier copies values into wasm on call, so shared scratch objects are safe to mutate every step.
const _desired = { x: 0, y: 0, z: 0 };
const _step = { x: 0, y: 0, z: 0 };
const _trans = { x: 0, y: 0, z: 0 };
const _notSensor = (c: Rapier.Collider) => !c.isSensor();
const _notSensorNotTerrain = (c: Rapier.Collider) => !c.isSensor() && !terrainColliders.has(c);

/** Colliders every capsule (the player, every server NPC) walks at FULL speed whatever their slope: the
 *  uphill fade is tuned on terrain and slows a building ramp (≈38°) to a crawl. A WeakSet of the collider
 *  OBJECTS (a ray hit returns the world's own object for its handle): a removed collider drops out by
 *  itself, and a reused handle never inherits the tag. Tag colliders at creation, in the process that
 *  creates them: physics/README.md "full-speed slopes". */
const fullSpeedSlopes = new WeakSet<Rapier.Collider>();
export const markFullSpeedSlope = (c: Rapier.Collider): void => {
  fullSpeedSlopes.add(c);
};

/** The TERRAIN heightfields, tagged at creation (world/terrain/chunk/utils.ts): a step with
 *  `ignoreTerrain` leaves them out of the ground probe and the sweep. Same WeakSet scheme. */
const terrainColliders = new WeakSet<Rapier.Collider>();
export const markTerrainCollider = (c: Rapier.Collider): void => {
  terrainColliders.add(c);
};

/** Fills while active, decays faster when not, saturates at 2× the delay (hysteresis on the way out). */
const bumpSlopeTimer = (t: number, active: boolean, dt: number, delay: number): number =>
  Math.max(0, Math.min(delay * 2, t + (active ? dt : -dt * SLOPE_TIMER_DECAY)));

/** What the downward ray found under the capsule this step. */
interface GroundProbe {
  /** Ground within the slope-adaptive reach. */
  nearGround: boolean;
  /** Ground within snap reach (whatever its slope). */
  supported: boolean;
  /** Radians; 0 when no ground is near. */
  angle: number;
  /** The ground is a full-speed slope (markFullSpeedSlope): no uphill fade. */
  fullSpeed: boolean;
  /** Upward ground normal; (0, 1, 0) when no ground is near. */
  nX: number;
  nY: number;
  nZ: number;
  /** How far the capsule can drop before the ground under it is near (nearGround); Infinity when the ray
   *  found none. */
  gap: number;
  /** How far the ground's surface stands ABOVE where the capsule would rest on it (a plane's tilt
   *  allowed for): over GROUND_EMBED_TOLERANCE the capsule is inside its ground. */
  embed: number;
}
const _probe: GroundProbe = { nearGround: false, supported: false, angle: 0, fullSpeed: false, nX: 0, nY: 1, nZ: 0, gap: Infinity, embed: 0 };

/** Probe EVERY step: computedGrounded() flickers false on steep surfaces, where this matters most. */
const probeGround = (
  world: Rapier.World,
  ray: Rapier.Ray,
  halfHeight: number,
  radius: number,
  collider: Rapier.Collider,
  body: Rapier.RigidBody,
  px: number,
  py: number,
  pz: number,
  filter: (c: Rapier.Collider) => boolean,
  /** How far the capsule falls this step: the ray reaches that much further, so the ground ahead is seen. */
  fall: number,
): GroundProbe => {
  const p = _probe;
  p.nearGround = false;
  p.gap = Infinity;
  p.supported = false;
  p.angle = 0;
  p.fullSpeed = false;
  p.nX = 0;
  p.nY = 1;
  p.nZ = 0;
  p.embed = 0;
  ray.origin.x = px;
  ray.origin.y = py;
  ray.origin.z = pz;
  const hit = world.castRayAndGetNormal(ray, Math.max(GROUND_RAY_LENGTH, halfHeight + GROUND_RAY_SLACK + fall), false, undefined, undefined, collider, body, filter);
  if (!hit) return p;
  // Trimesh normals can face either way — orient upward.
  const flip = hit.normal.y < 0 ? -1 : 1;
  const hnX = hit.normal.x * flip;
  const hnY = hit.normal.y * flip;
  const hnZ = hit.normal.z * flip;
  // Reach scales 1/cos(angle) with the hit's own normal; ~76°+ counts as wall, not ground.
  const allowed = halfHeight / Math.max(hnY, 0.25) + GROUND_RAY_SLACK;
  p.gap = hit.timeOfImpact - allowed;
  if (hit.timeOfImpact > GROUND_RAY_LENGTH) return p;
  if (hit.timeOfImpact <= allowed) {
    p.nearGround = true;
    p.nX = hnX;
    p.nY = hnY;
    p.nZ = hnZ;
    p.angle = Math.acos(Math.min(Math.max(hnY, -1), 1));
    p.fullSpeed = fullSpeedSlopes.has(hit.collider);
  }
  p.supported = hit.timeOfImpact <= halfHeight / Math.max(hnY, 0.25) + SNAP_TO_GROUND + 0.1;
  // Resting on a plane of normal nY, the bottom sphere's centre stands radius / nY over it along the
  // column: the ray's rest distance is the cylinder's half plus that.
  p.embed = halfHeight - radius + radius / Math.max(hnY, 0.25) - hit.timeOfImpact;
  return p;
};

const _walk = { x: 0, z: 0 };

/** The input direction at `speed`, with only the UPHILL component slowed on a soft slope
 *  (contour and downhill stay full speed). */
const steerWalk = (input: CharacterInput, speed: number, g: GroundProbe, s: CharacterMotionState, softStart: number, softEnd: number): { x: number; z: number } => {
  let mx = 0;
  let mz = 0;
  const inLenSq = input.dirX * input.dirX + input.dirZ * input.dirZ;
  if (inLenSq > 0) {
    const inv = 1 / Math.sqrt(inLenSq);
    mx = input.dirX * inv;
    mz = input.dirZ * inv;
    let scale = speed;
    const hLen = Math.hypot(g.nX, g.nZ);
    if (g.nearGround && hLen > 1e-5) {
      const uphillFactor = Math.max(0, (mx * -g.nX + mz * -g.nZ) / hLen);
      if (g.fullSpeed) {
        // The solve slides the walk up the slope plane, keeping cos² of its horizontal (62% at 38°):
        // 1/cos up front makes the speed ALONG the surface the walk speed.
        scale = speed * (1 + uphillFactor * (1 / Math.max(Math.cos(g.angle), 0.5) - 1));
      } else if (g.angle > softStart && s.softSlopeTime >= SLOPE_ENGAGE_DELAY) {
        const climb = 1 - smoothstep(softStart, softEnd, g.angle);
        scale = speed * (1 - uphillFactor * (1 - climb));
      }
    }
    mx *= scale;
    mz *= scale;
  }
  _walk.x = mx;
  _walk.z = mz;
  return _walk;
};

/** On a slide slope: accelerate down the fall line (gravity projected onto the slope plane), capped;
 *  off it the slide decays. */
const updateSlide = (s: CharacterMotionState, g: GroundProbe, onSlideSlope: boolean, dt: number): void => {
  if (!onSlideSlope) {
    s.slideSpeed = Math.max(0, s.slideSpeed - SLIDE_STOP_DECEL * dt);
    return;
  }
  const dx = g.nY * g.nX;
  const dy = g.nY * g.nY - 1;
  const dz = g.nY * g.nZ;
  const len = Math.hypot(dx, dy, dz);
  if (len > 0) {
    s.slideDirX = dx / len;
    s.slideDirY = dy / len;
    s.slideDirZ = dz / len;
  }
  s.slideSpeed = Math.min(SLIDE_MAX_SPEED, s.slideSpeed + -GRAVITY * Math.sin(g.angle) * dt);
};

/** Gravity (reset on support with the gap under the capsule closed: `resting`), the near-ground fall clamp
 *  and the jump — or the caller's own vy. A fall that would drop past the near-ground band this step is
 *  slowed to land in it (`gap`): the clamp then holds it, at any terminal velocity. */
const updateVertical = (s: CharacterMotionState, input: CharacterInput, supported: boolean, resting: boolean, nearGround: boolean, gap: number, onSlideSlope: boolean, dt: number): void => {
  if (input.vyOverride != null) {
    s.vy = input.vyOverride;
    return;
  }
  if (supported && resting && s.vy <= 0) {
    s.vy = 0;
  } else {
    s.vy = Math.max(s.vy + GRAVITY * dt, TERMINAL_VELOCITY);
  }
  if (nearGround && s.vy < NEAR_GROUND_FALL_SPEED_CAP) {
    s.vy = NEAR_GROUND_FALL_SPEED_CAP;
  } else if (!nearGround && s.vy * dt < -gap) {
    s.vy = Math.max(s.vy, Math.min(-gap / dt, NEAR_GROUND_FALL_SPEED_CAP));
  }
  if (input.jump && supported && !onSlideSlope && s.vy <= 0) {
    s.vy = JUMP_IMPULSE;
  }
};

/** Whether the capsule centered at `py` swims under `swim`'s surface. */
const isSwimming = (swim: SwimInput | null | undefined, py: number, height: number): swim is SwimInput =>
  !!swim && swim.surfaceY - (py - height / 2) > height * SWIM_SUBMERGED_FRACTION;

/** The swim's vy, or false while a breach is still rising (plain gravity carries it out of the water).
 *  `onBed`: resting on ray-confirmed support, where the sink stops (pressed on into a slope, the solve
 *  deflected it down the fall line: a swimmer crept 0.15u/s down a 50° bed). */
const updateSwimVertical = (s: CharacterMotionState, swim: SwimInput, py: number, height: number, onBed: boolean, dt: number): boolean => {
  if (s.breaching) {
    if (s.vy > 0) return false;
    s.breaching = false;
  }
  const head = py + height / 2;
  const thick = LIQUID_VISCOSITY[swim.liquid];
  if (swim.jumpPressed && head > swim.surfaceY - SWIM_BREACH_REACH) {
    s.vy = SWIM_BREACH_IMPULSE / thick;
    s.breaching = true;
    return true;
  }
  const sinkSpeed = SWIM_SINK_SPEED / thick;
  if (swim.jumpPressed) s.vy = Math.max(s.vy, SWIM_STROKE_IMPULSE / thick);
  if (s.vy < sinkSpeed) s.vy += (sinkSpeed - s.vy) * (1 - Math.exp(-WATER_DRAG * thick * dt));
  else if (s.vy > sinkSpeed) s.vy = Math.max(sinkSpeed, s.vy - (SWIM_SINK_ACCEL / thick) * dt);
  // A stroke from deep stops with the head at the surface instead of shooting out: only a press near it breaches.
  if (s.vy > 0) s.vy = Math.min(s.vy, Math.max(0, swim.surfaceY + SWIM_HEAD_ABOVE_SURFACE - head) / dt);
  else if (onBed) s.vy = 0;
  return true;
};

/** Sweeps `_desired` from (px, py, pz) in substeps of ≤ MAX_SUBSTEP_DISTANCE and sets the body's next
 *  kinematic translation to the result (written to `_trans`). Between substeps the body teleports to
 *  the corrected spot (invisible — physics steps after this), then is restored and moved kinematically
 *  so dynamic-body interactions see proper velocities. */
const sweepSubstepped = (
  world: Rapier.World,
  controller: Rapier.KinematicCharacterController,
  body: Rapier.RigidBody,
  collider: Rapier.Collider,
  px: number,
  py: number,
  pz: number,
  filter: (c: Rapier.Collider) => boolean,
): void => {
  const dist = Math.sqrt(_desired.x * _desired.x + _desired.y * _desired.y + _desired.z * _desired.z);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / MAX_SUBSTEP_DISTANCE)));
  _step.x = _desired.x / steps;
  _step.y = _desired.y / steps;
  _step.z = _desired.z / steps;
  let fx = px;
  let fy = py;
  let fz = pz;
  for (let i = 0; i < steps; i++) {
    controller.computeColliderMovement(collider, _step, undefined, undefined, filter);
    const corrected = controller.computedMovement();
    fx += corrected.x;
    fy += corrected.y;
    fz += corrected.z;
    if (steps > 1 && i < steps - 1) {
      // Colliders only follow their body at the physics step — propagate
      // explicitly so the next substep's sweep starts from this spot.
      _trans.x = fx;
      _trans.y = fy;
      _trans.z = fz;
      body.setTranslation(_trans, false);
      world.propagateModifiedBodyPositionsToColliders();
    }
  }
  if (steps > 1) {
    _trans.x = px;
    _trans.y = py;
    _trans.z = pz;
    body.setTranslation(_trans, false);
    world.propagateModifiedBodyPositionsToColliders();
  }
  _trans.x = fx;
  _trans.y = fy;
  _trans.z = fz;
  body.setNextKinematicTranslation(_trans);
};

/** One step for a capsule at body center (px, py, pz): sets the body's NEXT
 *  kinematic translation and fills `out`. `dt` is the caller's already-clamped delta. Every capsule
 *  feels its ground: `input.surface` and a liquid over its feet (`input.swim`) scale its walk and its
 *  slope limits (physics/movement-modifiers/constants.ts SURFACE_MOVEMENT). */
export const stepCharacter = (
  world: Rapier.World,
  c: Character,
  body: Rapier.RigidBody,
  collider: Rapier.Collider,
  px: number,
  py: number,
  pz: number,
  input: CharacterInput,
  dt: number,
  out: CharacterStepResult,
): CharacterStepResult => {
  const { controller, ray, state: s } = c;
  const filter = input.ignoreTerrain ? _notSensorNotTerrain : _notSensor;
  const grounded = controller.computedGrounded();
  const ground = probeGround(world, ray, c.shape.height / 2, c.shape.radius, collider, body, px, py, pz, filter, Math.max(0, -Math.min(s.vy + GRAVITY * dt, 0)) * dt);
  const liquid = input.swim && input.swim.surfaceY > py - c.shape.height / 2 ? SURFACE_MOVEMENT[input.swim.liquid] : null;
  const speedFactor = (input.surface ? input.surface.speedFactor : 1) * (liquid ? liquid.speed : 1);
  // Water overrides the ground's slopes: a swimmer never slides down the bed or is slowed up it.
  const swimming = input.vyOverride == null && isSwimming(input.swim, py, c.shape.height);
  const slopes = applySlopeLimits(c, (input.surface ? input.surface.slopeFactor : 1) * (liquid ? liquid.slope : 1), swimming);

  s.softSlopeTime = bumpSlopeTimer(s.softSlopeTime, ground.nearGround && ground.angle > slopes.softStart, dt, SLOPE_ENGAGE_DELAY);
  s.steepSlopeTime = bumpSlopeTimer(s.steepSlopeTime, ground.nearGround && ground.angle > slopes.slide, dt, SLIDE_ENGAGE_DELAY);
  const onSlideSlope = s.steepSlopeTime >= SLIDE_ENGAGE_DELAY;
  // Do NOT gate support on computedGrounded() alone: it flickers false on
  // heightfields (gravity wound up and deflected into permanent drift on 2–3°
  // slopes) AND holds true on steep faces (a pushed capsule crept UP 44°).
  const walkableSupport = ground.supported && ground.angle <= slopes.slide;

  const walk = steerWalk(input, input.speed * speedFactor, ground, s, slopes.softStart, slopes.softEnd);
  updateSlide(s, ground, onSlideSlope, dt);
  if (!swimming) s.breaching = false;
  // Support reaches SNAP_TO_GROUND under the feet, and the controller snaps only a MOVING capsule: a
  // fall that stopped on support alone hung a still capsule up to 0.4u over the floor after a jump.
  const restGap = CONTROLLER_CONTACT_OFFSET + SUPPORT_REST_GAP;
  const resting = ground.embed >= -restGap;
  // The contact offset is held along the NORMAL, so on a slope the column's gap is 1/nY of it (a swimmer
  // at rest on a 50° bed read 0.156u, past the flat 0.13u). Only the swim reads it: the land's `resting`
  // is a fall-through defense.
  const onBed = walkableSupport && ground.embed >= -restGap / Math.max(ground.nY, 0.25);
  if (!swimming || !updateSwimVertical(s, input.swim!, py, c.shape.height, onBed, dt)) {
    updateVertical(s, input, grounded || walkableSupport, resting, ground.nearGround, ground.gap, onSlideSlope, dt);
  }

  _desired.x = (walk.x + s.slideDirX * s.slideSpeed) * dt;
  _desired.y = s.vy * dt + s.slideDirY * s.slideSpeed * dt;
  _desired.z = (walk.z + s.slideDirZ * s.slideSpeed) * dt;
  if (ground.embed > GROUND_EMBED_TOLERANCE) _desired.y += Math.min(ground.embed, GROUND_EMBED_RECOVERY);
  const movementDistSq = _desired.x * _desired.x + _desired.y * _desired.y + _desired.z * _desired.z;
  if (movementDistSq > MAX_MOVEMENT_PER_FRAME * MAX_MOVEMENT_PER_FRAME) {
    const k = MAX_MOVEMENT_PER_FRAME / Math.sqrt(movementDistSq);
    _desired.x *= k;
    _desired.y *= k;
    _desired.z *= k;
  }
  sweepSubstepped(world, controller, body, collider, px, py, pz, filter);
  // A rise the sweep stopped short of (a ceiling) ends the rise: kept, the upward speed drained by gravity
  // alone and held the head against the ceiling for a moment before the fall.
  if (s.vy > 0 && _desired.y > 0 && _trans.y - py < _desired.y * CEILING_BLOCKED_FRACTION) s.vy = 0;

  out.x = _trans.x;
  out.y = _trans.y;
  out.z = _trans.z;
  out.grounded = grounded;
  out.walkableSupport = walkableSupport;
  out.nearGround = ground.nearGround;
  out.groundAngle = ground.angle;
  out.onSlideSlope = onSlideSlope;
  out.swimming = swimming;
  out.desiredX = _desired.x;
  out.desiredZ = _desired.z;
  return out;
};

export const createStepResult = (): CharacterStepResult => ({
  x: 0,
  y: 0,
  z: 0,
  grounded: false,
  walkableSupport: false,
  nearGround: false,
  groundAngle: 0,
  onSlideSlope: false,
  swimming: false,
  desiredX: 0,
  desiredZ: 0,
});
