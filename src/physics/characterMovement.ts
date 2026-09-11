import type Rapier from "@dimforge/rapier3d-compat";

/**
 * CHARACTER MOVEMENT — the ONE movement resolver for every kinematic capsule
 * that walks on terrain: the local player (player/Player.tsx) and, on the
 * server, every synced NPC (server/src/game/physics). Extracted VERBATIM from
 * the player's controller so a single tuning drives both; nothing about the
 * player's feel lives anywhere else.
 *
 * Same contract as objects/actors/state/runner.ts: Rapier types only, NO
 * Three, NO React, no hooks, no scene — Node runs this file through the
 * server's esbuild bundle. The caller owns the body and hands in the Rapier
 * runtime it has (the client's `useRapier().rapier`, the server's module
 * namespace); this module only needs the `Ray` constructor from it.
 *
 * What it does per step, in order (each block's WHY is documented at the code):
 *   ground probe (slope-adaptive ray) → leaky slope timers → slope-shaped
 *   input (uphill component fades 25°→45°) → fall-line slide above 40° →
 *   gravity with ray-based support + near-ground fall clamp → jump →
 *   clamped desired movement → SUBSTEPPED KinematicCharacterController solve
 *   (≤ ~capsule-radius sweeps, colliders propagated between) → the body's next
 *   kinematic translation.
 *
 * What stays with the caller: reading input, the analytic terrain backstop
 * and stuck escape (they need the height function — async on the client),
 * respawn, camera.
 */

// ---- Controller ----
// Gap the controller keeps from surfaces. 0.02 was thin enough that fast
// glancing contact on steep slopes could numerically penetrate the terrain
// trimesh — and a sweep that STARTS inside a triangle passes through it
// (the fall-through-the-map bug). 0.08 keeps the capsule reliably outside.
export const CC_OFFSET = 0.08;
export const SNAP_TO_GROUND = 0.3;

// ---- Slopes ----
// Two INDEPENDENT responses, both driven by the ground-normal raycast:
//   SLOWDOWN (SOFT_START..SOFT_END): the UPHILL component of input scales
//     smoothly from 1 → 0 (walking along the contour or downhill stays full
//     speed). The band is deliberately WIDE so it creeps in gradually.
//   SLIDE (> SLIDE_ANGLE): unclimbable — the character slides down the slope's
//     fall line, accelerating with gravity's tangential component; momentum
//     bleeds off quickly on walkable ground. No jumping mid-slide. The Rapier
//     controller's own climb limit sits here too (hard wall + deflection).
//
// SLIDE_ANGLE is set from a MEASURED slope distribution of the real terrain
// (sampled at LOD1 collider resolution, 4.375u, across grassland — the
// steepest biome). Natural terrain tops out at ~47°:
//     median 25.6° | p90 35.3° | p99 42.6° | max 46.9°
//     >35°: 10.7% of area | >40°: 3.6% | >45°: 0.17% | >50°: NONE
// Capsule-solid steep spots (whole footprint steep, not a one-triangle
// sliver) are what a capsule can actually stand on: 257 in a 600×600 patch
// at 40°, but only 15 at 45° and 5 at 50°. So 55° was UNREACHABLE — nothing
// in the world is that steep except flatten-pad skirts, which is why sliding
// stopped happening entirely. 40° is the value where genuine steep faces
// exist without being everywhere. Re-measure before changing this if the
// terrain noise changes.
export const SLOPE_SOFT_START = 25 * (Math.PI / 180);
export const SLOPE_SOFT_END = 45 * (Math.PI / 180);
export const SLOPE_SLIDE_ANGLE = 40 * (Math.PI / 180);
// Both responses require PERSISTENCE — this many seconds of steep ground
// before they engage. Flatten-pad edges and heightfield slivers are tiny
// steep faces the probe clips for a frame or two; reacting instantly to those
// made walking anywhere feel like sliding. The timers LEAK rather than reset
// (decay at DECAY× fill rate, saturating at 2× the delay) so genuinely steep
// but bumpy ground still engages, a lone sliver never does, and an engaged
// slide doesn't stutter off on one flat triangle.
export const SLOPE_ENGAGE_DELAY = 0.1;
export const SLIDE_ENGAGE_DELAY = 0.15;
export const SLOPE_TIMER_DECAY = 2;
export const SLIDE_MAX_SPEED = 30;
export const SLIDE_STOP_DECEL = 60; // how fast leftover slide momentum dies on walkable ground
// Near ANY ground, gravity must not wind up to terminal velocity. Two
// separate bugs share this cause: a huge downward component fed into a
// glancing steep contact punches through the trimesh, and on gentle ground it
// gets deflected sideways into permanent drift. The slide vector provides the
// downhill motion; this just keeps the capsule pressed to the surface.
export const SLIDE_FALL_CLAMP = -20;

// ---- Gravity (manually integrated for the kinematic character controller) ----
export const GRAVITY = -100;
export const TERMINAL_VELOCITY = -150;
export const JUMP_IMPULSE = 40;
export const MAX_MOVEMENT_PER_FRAME = 8;
// The KCC solve is SUBSTEPPED so no single swept solve moves farther than
// ~the capsule radius: one long glancing sweep along a steep slope is the
// other half of the tunneling bug (corrections apply too late, penetration
// accumulates). 16 substeps covers MAX_MOVEMENT_PER_FRAME.
export const MAX_SUBSTEP_DISTANCE = 0.5;
export const MAX_SUBSTEPS = 16;

// ---- Ground probe ----
// Cast long, then accept the hit adaptively by SLOPE — the vertical distance
// from the capsule center to the surface grows as 1/cos(angle) on inclines
// (the capsule rests against them sideways). A fixed feet-length reach was
// used before and REJECTED: beyond ~55° the ray stopped reaching the ground,
// so the steep-slope slide never engaged and jumping stayed possible exactly
// on the slopes that should forbid it.
export const GROUND_RAY_LENGTH = 5;
export const GROUND_RAY_SLACK = SNAP_TO_GROUND + 0.4;

/** Capsule dimensions: total height (feet to top) and radius. */
export interface CharacterShape {
  height: number;
  radius: number;
}

/** Everything that persists between steps. Plain numbers, mutated in place. */
export interface CharacterMotionState {
  vy: number;
  slideSpeed: number;
  // Persists across frames: the last slide direction keeps pushing while the
  // leftover momentum decays after reaching walkable ground.
  slideDirX: number;
  slideDirY: number;
  slideDirZ: number;
  // Seconds of CONTINUOUS steep ground under the probe (see the engage delays).
  softSlopeTime: number;
  steepSlopeTime: number;
}

/** The per-step input: horizontal direction (any length; zero = no input),
 *  speed to move at, and whether a jump is requested. */
export interface CharacterInput {
  dirX: number;
  dirZ: number;
  speed: number;
  jump: boolean;
  /** Drive the vertical velocity directly this step (an NPC's ascend); gravity,
   *  the near-ground clamp and jump are skipped. null/undefined = gravity. */
  vyOverride?: number | null;
}

/** What one step produced. Positions are the body CENTER after the solve
 *  (the body's next kinematic translation has been set to it). */
export interface CharacterStepResult {
  x: number;
  y: number;
  z: number;
  /** Rapier's own grounded flag from the solve. */
  grounded: boolean;
  /** Ray says the capsule stands on walkable (≤ slide angle) ground. */
  walkableSupport: boolean;
  nearGround: boolean;
  /** Surface angle under the capsule, radians (0 when no ground probed). */
  groundAngle: number;
  onSlideSlope: boolean;
  /** Horizontal DESIRED translation this step — for the caller's stuck detection. */
  desiredX: number;
  desiredZ: number;
}

/** The slice of the Rapier runtime this module constructs from. */
export interface RapierRuntime {
  Ray: new (origin: Rapier.Vector, dir: Rapier.Vector) => Rapier.Ray;
}

export interface Character {
  controller: Rapier.KinematicCharacterController;
  ray: Rapier.Ray;
  shape: CharacterShape;
  state: CharacterMotionState;
}

export const createCharacterMotionState = (): CharacterMotionState => ({
  vy: 0,
  slideSpeed: 0,
  slideDirX: 0,
  slideDirY: 0,
  slideDirZ: 0,
  softSlopeTime: 0,
  steepSlopeTime: 0,
});

export const resetCharacterMotion = (s: CharacterMotionState): void => {
  s.vy = 0;
  s.slideSpeed = 0;
};

/** The character controller with THE tuning (identical for every character). */
export const createCharacterController = (world: Rapier.World): Rapier.KinematicCharacterController => {
  const controller = world.createCharacterController(CC_OFFSET);
  // The hard wall lives at SLIDE_ANGLE — everything below it is climbable
  // but speed-shaped in the step, and beyond it the controller both blocks
  // climbing and deflects gravity down the slope. (The slowdown curve runs to
  // SOFT_END, past the wall — so uphill speed is already down to ~16% when
  // the slide takes over, with no dead zone between them.)
  controller.setMaxSlopeClimbAngle(SLOPE_SLIDE_ANGLE + 0.01);
  controller.setMinSlopeSlideAngle(SLOPE_SLIDE_ANGLE);
  // Push the capsule OUT along contact normals noticeably harder than the
  // default (1e-4): shallow penetrations on steep glancing contacts must
  // recover instead of accumulating until a sweep starts inside the trimesh.
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
});

export const disposeCharacter = (world: Rapier.World, c: Character): void => {
  world.removeCharacterController(c.controller);
};

// Reused Rapier-facing scratch (Rapier copies the values into wasm on call,
// so the same objects are safe to mutate every step — the substep loop
// otherwise allocated up to 17 literals per frame)
const _desired = { x: 0, y: 0, z: 0 };
const _step = { x: 0, y: 0, z: 0 };
const _trans = { x: 0, y: 0, z: 0 };
const _notSensor = (c: Rapier.Collider) => !c.isSensor();

const smooth01 = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** Leaky persistence timer: fills while the condition holds, decays faster
 *  when it doesn't, and saturates at 2× the engage delay so an engaged
 *  response has hysteresis on the way out. */
const bumpSlopeTimer = (t: number, active: boolean, dt: number, delay: number): number =>
  Math.max(0, Math.min(delay * 2, t + (active ? dt : -dt * SLOPE_TIMER_DECAY)));

/**
 * Resolve one step of movement for a kinematic capsule at body center
 * (px, py, pz). Sets the body's NEXT kinematic translation (applied at the
 * world step) and fills `out`. `dt` is the caller's already-clamped delta.
 */
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
  const halfHeight = c.shape.height / 2;
  const grounded = controller.computedGrounded();

  // ---- Ground slope probe (capsule center straight down) ----
  // Runs EVERY step, not just when computedGrounded() says so — Rapier's
  // grounded flag flickers false on too-steep surfaces, which is exactly
  // where the slope logic matters most.
  let nearGround = false;
  let groundSupported = false;
  let groundAngle = 0;
  let nX = 0;
  let nY = 1;
  let nZ = 0;
  ray.origin.x = px;
  ray.origin.y = py;
  ray.origin.z = pz;
  const hit = world.castRayAndGetNormal(ray, GROUND_RAY_LENGTH, false, undefined, undefined, collider, body, _notSensor);
  if (hit) {
    // Trimesh normals can face either way — orient upward.
    const flip = hit.normal.y < 0 ? -1 : 1;
    const hnX = hit.normal.x * flip;
    const hnY = hit.normal.y * flip;
    const hnZ = hit.normal.z * flip;
    // Slope-adaptive acceptance: on an incline the surface sits
    // 1/cos(angle) farther below the center, so the allowed distance
    // scales with the hit's own normal (flat ground: feet + snap, same
    // as the old fixed reach; ~76°+ counts as wall, not ground).
    const allowed = halfHeight / Math.max(hnY, 0.25) + GROUND_RAY_SLACK;
    if (hit.timeOfImpact <= allowed) {
      nearGround = true;
      nX = hnX;
      nY = hnY;
      nZ = hnZ;
      groundAngle = Math.acos(Math.min(Math.max(nY, -1), 1));
    }
    // Tighter test: the surface is within snapping reach, i.e. the
    // controller is genuinely standing on it rather than merely near it.
    groundSupported = hit.timeOfImpact <= halfHeight / Math.max(hnY, 0.25) + SNAP_TO_GROUND + 0.1;
  }

  // Slope responses only engage after the ground has been steep for a
  // sustained moment — a single step clipping a pad edge or a heightfield
  // sliver must not trigger them.
  s.softSlopeTime = bumpSlopeTimer(s.softSlopeTime, nearGround && groundAngle > SLOPE_SOFT_START, dt, SLOPE_ENGAGE_DELAY);
  s.steepSlopeTime = bumpSlopeTimer(s.steepSlopeTime, nearGround && groundAngle > SLOPE_SLIDE_ANGLE, dt, SLIDE_ENGAGE_DELAY);

  const onSlideSlope = s.steepSlopeTime >= SLIDE_ENGAGE_DELAY;
  // Gravity/jump support: computedGrounded() alone FLICKERS false on
  // heightfield terrain, and every flickered frame integrated gravity
  // without reset — winding toward terminal velocity, which the controller
  // then deflected along even a 2–3° slope into permanent horizontal drift
  // (the "always sliding no matter how flat" bug) while snap-to-ground kept
  // the capsule glued down. The raycast is re-evaluated every step, so it
  // can't accumulate that way. Do NOT gate support on the flag alone.
  // (And the converse, MEASURED headless: the flag holds TRUE on steep
  // heightfield faces, so gating on it alone reset gravity there and let a
  // pushed capsule creep UP a 44° slope — the ≤ slide-angle test is what
  // makes steep ground unsupported so the slide can happen.)
  const walkableSupport = groundSupported && groundAngle <= SLOPE_SLIDE_ANGLE;

  // ---- Input, shaped by slope ----
  let mx = 0;
  let mz = 0;
  const inLenSq = input.dirX * input.dirX + input.dirZ * input.dirZ;
  if (inLenSq > 0) {
    const inv = 1 / Math.sqrt(inLenSq);
    mx = input.dirX * inv;
    mz = input.dirZ * inv;
    // In the soft band, only the UPHILL component of the input slows —
    // full speed along the contour and downhill.
    let scale = input.speed;
    if (nearGround && groundAngle > SLOPE_SOFT_START && s.softSlopeTime >= SLOPE_ENGAGE_DELAY) {
      const hLen = Math.hypot(nX, nZ);
      if (hLen > 1e-5) {
        const upX = -nX / hLen;
        const upZ = -nZ / hLen;
        const uphillFactor = Math.max(0, mx * upX + mz * upZ);
        const climb = 1 - smooth01((groundAngle - SLOPE_SOFT_START) / (SLOPE_SOFT_END - SLOPE_SOFT_START));
        scale = input.speed * (1 - uphillFactor * (1 - climb));
      }
    }
    mx *= scale;
    mz *= scale;
  }

  // ---- Slide on unclimbable slopes ----
  if (onSlideSlope) {
    // Fall line: gravity projected onto the slope plane.
    const dx = nY * nX;
    const dy = nY * nY - 1;
    const dz = nY * nZ;
    const len = Math.hypot(dx, dy, dz);
    if (len > 0) {
      s.slideDirX = dx / len;
      s.slideDirY = dy / len;
      s.slideDirZ = dz / len;
    }
    s.slideSpeed = Math.min(SLIDE_MAX_SPEED, s.slideSpeed + -GRAVITY * Math.sin(groundAngle) * dt);
  } else {
    // Leftover momentum carries in the last slide direction and bleeds
    // off quickly once the ground is walkable again.
    s.slideSpeed = Math.max(0, s.slideSpeed - SLIDE_STOP_DECEL * dt);
  }

  if (input.vyOverride != null) {
    // Driven vertical (NPC ascend): the caller owns vy this step.
    s.vy = input.vyOverride;
  } else {
    // Gravity integration (capped at terminal velocity)
    if ((grounded || walkableSupport) && s.vy <= 0) {
      s.vy = 0;
    } else {
      s.vy = Math.max(s.vy + GRAVITY * dt, TERMINAL_VELOCITY);
    }
    // Near ANY ground, cap the fall speed. Without this, gravity winds
    // toward terminal velocity while the capsule scrapes the surface at a
    // glancing angle — the huge downward sweep both punches the capsule
    // through the terrain trimesh and gets deflected into sideways drift.
    if (nearGround && s.vy < SLIDE_FALL_CLAMP) {
      s.vy = SLIDE_FALL_CLAMP;
    }

    // Jump — not while sliding on an unclimbable slope. Uses the ray-based
    // support too, so a flickered grounded flag can't eat a jump input.
    if (input.jump && (grounded || walkableSupport) && !onSlideSlope && s.vy <= 0) {
      s.vy = JUMP_IMPULSE;
    }
  }

  // Compute desired movement, clamped so the swept capsule query stays reliable
  _desired.x = (mx + s.slideDirX * s.slideSpeed) * dt;
  _desired.y = s.vy * dt + s.slideDirY * s.slideSpeed * dt;
  _desired.z = (mz + s.slideDirZ * s.slideSpeed) * dt;
  const movementDistSq = _desired.x * _desired.x + _desired.y * _desired.y + _desired.z * _desired.z;
  if (movementDistSq > MAX_MOVEMENT_PER_FRAME * MAX_MOVEMENT_PER_FRAME) {
    const k = MAX_MOVEMENT_PER_FRAME / Math.sqrt(movementDistSq);
    _desired.x *= k;
    _desired.y *= k;
    _desired.z *= k;
  }

  // Let the character controller compute collision-corrected movement.
  // SUBSTEPPED: each swept solve covers at most ~a capsule radius. One
  // long sweep along a glancing steep contact lets penetration build up
  // before the correction lands — and a sweep that starts inside the
  // trimesh falls straight through. Between substeps the body teleports
  // to the corrected spot (invisible — physics steps after this); at the
  // end it's restored and moved kinematically so dynamic-body interactions
  // see proper velocities.
  const dist = Math.sqrt(_desired.x * _desired.x + _desired.y * _desired.y + _desired.z * _desired.z);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dist / MAX_SUBSTEP_DISTANCE)));
  _step.x = _desired.x / steps;
  _step.y = _desired.y / steps;
  _step.z = _desired.z / steps;
  let fx = px;
  let fy = py;
  let fz = pz;
  for (let i = 0; i < steps; i++) {
    controller.computeColliderMovement(collider, _step, undefined, undefined, _notSensor);
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

  out.x = fx;
  out.y = fy;
  out.z = fz;
  out.grounded = grounded;
  out.walkableSupport = walkableSupport;
  out.nearGround = nearGround;
  out.groundAngle = groundAngle;
  out.onSlideSlope = onSlideSlope;
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
  desiredX: 0,
  desiredZ: 0,
});
