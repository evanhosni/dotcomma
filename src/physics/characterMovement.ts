import type Rapier from "@dimforge/rapier3d-compat";
import { smoothstep } from "../utils/math/_math";
import type { MovementModifiers } from "./movementModifiers";

/**
 * THE movement resolver for every kinematic capsule (local player + server
 * NPCs): tune here, nowhere else. No Three, no React (of Rapier, types only),
 * because the server's esbuild bundle runs this file. The measurements behind the
 * constants are in CLAUDE.md (player/Player.tsx).
 */

// 0.02 let a fast glancing contact penetrate the terrain trimesh, and a sweep
// that STARTS inside a triangle passes through it (fall-through-the-map).
export const CONTROLLER_CONTACT_OFFSET = 0.08;
export const SNAP_TO_GROUND = 0.3;

// Uphill input fades to 0 across SOFT_START..SOFT_END; above SLIDE_ANGLE the
// character slides down the fall line. SLIDE_ANGLE comes from the measured
// slope distribution (LOD1 resolution, grassland): median 25.6°, p99 42.6°,
// >45° = 0.17% of area, >50° none; capsule-solid steep spots per 600×600
// patch: 257 at 40°, 15 at 45°. 55° was unreachable (sliding never happened).
// Re-measure before retuning if the terrain noise changes.
export const SLOPE_SOFT_START = 25 * (Math.PI / 180);
export const SLOPE_SOFT_END = 45 * (Math.PI / 180);
export const SLOPE_SLIDE_ANGLE = 40 * (Math.PI / 180);
// Seconds of steep ground before a response engages: pad edges and heightfield
// slivers clip the probe for a frame or two, and reacting instantly made all
// walking feel like sliding. Timers LEAK (decay at DECAY× the fill rate,
// saturate at 2× the delay) so bumpy-but-steep ground still engages.
export const SLOPE_ENGAGE_DELAY = 0.1;
export const SLIDE_ENGAGE_DELAY = 0.15;
export const SLOPE_TIMER_DECAY = 2;
export const SLIDE_MAX_SPEED = 30;
export const SLIDE_STOP_DECEL = 60;
// Fall-speed cap near ANY ground: a terminal-velocity scrape at a glancing
// angle punches through the trimesh, and on gentle ground deflects into drift.
export const NEAR_GROUND_FALL_SPEED_CAP = -20;

/** u/s². Also the Rapier world gravity on the client (CustomCanvas) and the server (physicsWorld.ts). */
export const GRAVITY = -100;
export const TERMINAL_VELOCITY = -150;
export const JUMP_IMPULSE = 40;
export const MAX_MOVEMENT_PER_FRAME = 8;
// No single swept solve moves farther than ~a capsule radius (one long
// glancing sweep accumulates penetration). 16 substeps covers MAX_MOVEMENT_PER_FRAME.
export const MAX_SUBSTEP_DISTANCE = 0.5;
export const MAX_SUBSTEPS = 16;

// Cast long; acceptance is slope-adaptive (surface sits 1/cos(angle) below the
// center on inclines). A fixed feet-length reach missed the ground beyond
// ~55°, so the slide never engaged and jumping stayed possible exactly there.
export const GROUND_RAY_LENGTH = 5;
export const GROUND_RAY_SLACK = SNAP_TO_GROUND + 0.4;
// A capsule EMBEDDED in its ground (the ground ray meets a surface above where the capsule would rest
// on it) rises out of it this much a step: the controller never pushes a shape out of a one-sided
// trimesh it already intersects (a sewer floor held a capsule 0.25u under it indefinitely), and a
// frame without a collider is how it gets in. Over TOLERANCE only: a standing capsule reads the
// contact offset's -0.08.
export const GROUND_EMBED_TOLERANCE = 0.03;
export const GROUND_EMBED_RECOVERY = 0.1;

// SWIMMING (input.swim): under water the capsule sinks slowly, a held jump swims up and floats the
// head just above the surface, and a fresh press with the head near the surface breaches out of it.
/** Fraction of the capsule's height under the surface before it swims rather than wades. */
export const SWIM_SUBMERGED_FRACTION = 0.6;
export const SWIM_SINK_SPEED = -3;
export const SWIM_SINK_ACCEL = 12;
export const SWIM_UP_SPEED = 9;
export const SWIM_UP_ACCEL = 40;
/** 1/s: how fast a dive's fall speed bleeds off to the sink speed. */
export const WATER_DRAG = 5;
/** Under JUMP_IMPULSE: enough to clear the surface by about a body height. */
export const SWIM_BREACH_IMPULSE = 32;
export const SWIM_HEAD_ABOVE_SURFACE = 0.35;
/** A fresh press breaches while the head is less than this under the surface. */
export const SWIM_BREACH_REACH = 1.5;
/** Horizontal input speed multiplier while swimming. */
export const SWIM_SPEED_FACTOR = 0.55;

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
  /** The water surface over the capsule. */
  surfaceY: number;
  /** The jump key went down this step (not merely held). */
  jumpPressed: boolean;
  /** The liquid's viscosity relative to water (unset = 1): divides every swim speed and acceleration
   *  and multiplies the drag — the sewers' liquid is thick. */
  viscosity?: number;
}

export interface CharacterInput {
  dirX: number;
  dirZ: number;
  speed: number;
  jump: boolean;
  /** Caller drives vy this step (NPC ascend, a manhole climb); gravity, fall clamp and jump are skipped. */
  vyOverride?: number | null;
  /** Water over the capsule (unset = none): it swims once SWIM_SUBMERGED_FRACTION of it is under. */
  swim?: SwimInput | null;
  /** The terrain heightfields (markTerrainCollider) are neither ground nor obstacle this step: a
   *  player in a tunnel under them (player/undergroundMode.ts). */
  ignoreTerrain?: boolean;
  /** What the ground under the capsule does to its walk and its grip (movementModifiers.ts: the snow's
   *  drag and traction; unset = neutral). Sampled by the CALLER on a worker (`surfaceModifiersAt`) and
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

/** The step's slope limits: the constants plus the surface's traction (movementModifiers.ts). */
const _slopes = { softStart: SLOPE_SOFT_START, softEnd: SLOPE_SOFT_END, slide: SLOPE_SLIDE_ANGLE };
const applySlopeLimits = (c: Character, surface: MovementModifiers | null | undefined): typeof _slopes => {
  const bonus = surface ? surface.slopeBonus : 0;
  _slopes.softStart = SLOPE_SOFT_START + bonus;
  _slopes.softEnd = SLOPE_SOFT_END + bonus;
  _slopes.slide = SLOPE_SLIDE_ANGLE + bonus;
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

/** The TERRAIN heightfields, tagged at creation (world/terrain/chunkObjects.ts): a step with
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
  /** How far the ground's surface stands ABOVE where the capsule would rest on it (a plane's tilt
   *  allowed for): over GROUND_EMBED_TOLERANCE the capsule is inside its ground. */
  embed: number;
}
const _probe: GroundProbe = { nearGround: false, supported: false, angle: 0, fullSpeed: false, nX: 0, nY: 1, nZ: 0, embed: 0 };

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
): GroundProbe => {
  const p = _probe;
  p.nearGround = false;
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
  const hit = world.castRayAndGetNormal(ray, GROUND_RAY_LENGTH, false, undefined, undefined, collider, body, filter);
  if (!hit) return p;
  // Trimesh normals can face either way — orient upward.
  const flip = hit.normal.y < 0 ? -1 : 1;
  const hnX = hit.normal.x * flip;
  const hnY = hit.normal.y * flip;
  const hnZ = hit.normal.z * flip;
  // Reach scales 1/cos(angle) with the hit's own normal; ~76°+ counts as wall, not ground.
  const allowed = halfHeight / Math.max(hnY, 0.25) + GROUND_RAY_SLACK;
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

/** Gravity (reset on support), the near-ground fall clamp and the jump — or the caller's own vy. */
const updateVertical = (s: CharacterMotionState, input: CharacterInput, supported: boolean, nearGround: boolean, onSlideSlope: boolean, dt: number): void => {
  if (input.vyOverride != null) {
    s.vy = input.vyOverride;
    return;
  }
  if (supported && s.vy <= 0) {
    s.vy = 0;
  } else {
    s.vy = Math.max(s.vy + GRAVITY * dt, TERMINAL_VELOCITY);
  }
  if (nearGround && s.vy < NEAR_GROUND_FALL_SPEED_CAP) {
    s.vy = NEAR_GROUND_FALL_SPEED_CAP;
  }
  if (input.jump && supported && !onSlideSlope && s.vy <= 0) {
    s.vy = JUMP_IMPULSE;
  }
};

/** Whether the capsule centered at `py` swims under `swim`'s surface. */
const isSwimming = (swim: SwimInput | null | undefined, py: number, height: number): swim is SwimInput =>
  !!swim && swim.surfaceY - (py - height / 2) > height * SWIM_SUBMERGED_FRACTION;

/** The swim's vy, or false while a breach is still rising (plain gravity carries it out of the water). */
const updateSwimVertical = (s: CharacterMotionState, input: CharacterInput, swim: SwimInput, py: number, height: number, dt: number): boolean => {
  if (s.breaching) {
    if (s.vy > 0) return false;
    s.breaching = false;
  }
  const head = py + height / 2;
  const thick = swim.viscosity ?? 1;
  if (swim.jumpPressed && head > swim.surfaceY - SWIM_BREACH_REACH) {
    s.vy = SWIM_BREACH_IMPULSE / thick;
    s.breaching = true;
    return true;
  }
  const sinkSpeed = SWIM_SINK_SPEED / thick;
  // The drag only approaches the sink speed, so it must not gate the strokes below.
  if (s.vy < sinkSpeed) s.vy += (sinkSpeed - s.vy) * (1 - Math.exp(-WATER_DRAG * thick * dt));
  if (input.jump) {
    s.vy = Math.min(SWIM_UP_SPEED / thick, s.vy + (SWIM_UP_ACCEL / thick) * dt);
    // Floats at the surface instead of shooting out of it: only a fresh press breaches.
    s.vy = Math.min(s.vy, (swim.surfaceY + SWIM_HEAD_ABOVE_SURFACE - head) / dt);
  } else if (s.vy > sinkSpeed) {
    s.vy = Math.max(sinkSpeed, s.vy - (SWIM_SINK_ACCEL / thick) * dt);
  }
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
 *  feels its ground: `input.surface` scales its walk and moves its slope limits (the snow's wading and
 *  traction, movementModifiers.ts). */
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
  const ground = probeGround(world, ray, c.shape.height / 2, c.shape.radius, collider, body, px, py, pz, filter);
  const slopes = applySlopeLimits(c, input.surface);

  s.softSlopeTime = bumpSlopeTimer(s.softSlopeTime, ground.nearGround && ground.angle > slopes.softStart, dt, SLOPE_ENGAGE_DELAY);
  s.steepSlopeTime = bumpSlopeTimer(s.steepSlopeTime, ground.nearGround && ground.angle > slopes.slide, dt, SLIDE_ENGAGE_DELAY);
  const onSlideSlope = s.steepSlopeTime >= SLIDE_ENGAGE_DELAY;
  // Do NOT gate support on computedGrounded() alone: it flickers false on
  // heightfields (gravity wound up and deflected into permanent drift on 2–3°
  // slopes) AND holds true on steep faces (a pushed capsule crept UP 44°).
  const walkableSupport = ground.supported && ground.angle <= slopes.slide;

  const walk = steerWalk(input, input.speed * (input.surface ? input.surface.speedFactor : 1), ground, s, slopes.softStart, slopes.softEnd);
  updateSlide(s, ground, onSlideSlope, dt);
  const swimming = input.vyOverride == null && isSwimming(input.swim, py, c.shape.height);
  if (swimming) {
    const factor = SWIM_SPEED_FACTOR / (input.swim!.viscosity ?? 1);
    walk.x *= factor;
    walk.z *= factor;
  } else {
    s.breaching = false;
  }
  if (!swimming || !updateSwimVertical(s, input, input.swim!, py, c.shape.height, dt)) {
    updateVertical(s, input, grounded || walkableSupport, ground.nearGround, onSlideSlope, dt);
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
