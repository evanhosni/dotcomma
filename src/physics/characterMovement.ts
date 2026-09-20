import type Rapier from "@dimforge/rapier3d-compat";

/**
 * THE movement resolver for every kinematic capsule (local player + server
 * NPCs): tune here, nowhere else. Rapier types only — no Three, no React —
 * because the server's esbuild bundle runs this file. See CLAUDE.md
 * (physics/characterMovement.ts) for the measured tuning history.
 */

// 0.02 let a fast glancing contact penetrate the terrain trimesh, and a sweep
// that STARTS inside a triangle passes through it (fall-through-the-map).
export const CONTROLLER_CONTACT_OFFSET = 0.08;
export const SNAP_TO_GROUND = 0.3;

// Uphill input fades to 0 across SOFT_START..SOFT_END; above SLIDE_ANGLE the
// character slides down the fall line. SLIDE_ANGLE comes from a MEASURED
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
}

export interface CharacterInput {
  dirX: number;
  dirZ: number;
  speed: number;
  jump: boolean;
  /** Caller drives vy this step (NPC ascend); gravity, fall clamp and jump are skipped. */
  vyOverride?: number | null;
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
});

export const disposeCharacter = (world: Rapier.World, c: Character): void => {
  world.removeCharacterController(c.controller);
};

// Rapier copies values into wasm on call, so shared scratch objects are safe to mutate every step.
const _desired = { x: 0, y: 0, z: 0 };
const _step = { x: 0, y: 0, z: 0 };
const _trans = { x: 0, y: 0, z: 0 };
const _notSensor = (c: Rapier.Collider) => !c.isSensor();

const smoothstep01 = (t: number): number => {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
};

/** Fills while active, decays faster when not, saturates at 2× the delay (hysteresis on the way out). */
const bumpSlopeTimer = (t: number, active: boolean, dt: number, delay: number): number =>
  Math.max(0, Math.min(delay * 2, t + (active ? dt : -dt * SLOPE_TIMER_DECAY)));

/** One step for a capsule at body center (px, py, pz): sets the body's NEXT
 *  kinematic translation and fills `out`. `dt` is the caller's already-clamped delta. */
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

  // Probe EVERY step: computedGrounded() flickers false on steep surfaces, where this matters most.
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
    // Reach scales 1/cos(angle) with the hit's own normal; ~76°+ counts as wall, not ground.
    const allowed = halfHeight / Math.max(hnY, 0.25) + GROUND_RAY_SLACK;
    if (hit.timeOfImpact <= allowed) {
      nearGround = true;
      nX = hnX;
      nY = hnY;
      nZ = hnZ;
      groundAngle = Math.acos(Math.min(Math.max(nY, -1), 1));
    }
    groundSupported = hit.timeOfImpact <= halfHeight / Math.max(hnY, 0.25) + SNAP_TO_GROUND + 0.1;
  }

  s.softSlopeTime = bumpSlopeTimer(s.softSlopeTime, nearGround && groundAngle > SLOPE_SOFT_START, dt, SLOPE_ENGAGE_DELAY);
  s.steepSlopeTime = bumpSlopeTimer(s.steepSlopeTime, nearGround && groundAngle > SLOPE_SLIDE_ANGLE, dt, SLIDE_ENGAGE_DELAY);

  const onSlideSlope = s.steepSlopeTime >= SLIDE_ENGAGE_DELAY;
  // Do NOT gate support on computedGrounded() alone: it flickers false on
  // heightfields (gravity wound up and deflected into permanent drift on 2–3°
  // slopes) AND holds true on steep faces (a pushed capsule crept UP 44°).
  const walkableSupport = groundSupported && groundAngle <= SLOPE_SLIDE_ANGLE;

  let mx = 0;
  let mz = 0;
  const inLenSq = input.dirX * input.dirX + input.dirZ * input.dirZ;
  if (inLenSq > 0) {
    const inv = 1 / Math.sqrt(inLenSq);
    mx = input.dirX * inv;
    mz = input.dirZ * inv;
    // Only the UPHILL component slows; contour and downhill stay full speed.
    let scale = input.speed;
    if (nearGround && groundAngle > SLOPE_SOFT_START && s.softSlopeTime >= SLOPE_ENGAGE_DELAY) {
      const hLen = Math.hypot(nX, nZ);
      if (hLen > 1e-5) {
        const upX = -nX / hLen;
        const upZ = -nZ / hLen;
        const uphillFactor = Math.max(0, mx * upX + mz * upZ);
        const climb = 1 - smoothstep01((groundAngle - SLOPE_SOFT_START) / (SLOPE_SOFT_END - SLOPE_SOFT_START));
        scale = input.speed * (1 - uphillFactor * (1 - climb));
      }
    }
    mx *= scale;
    mz *= scale;
  }

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
    s.slideSpeed = Math.max(0, s.slideSpeed - SLIDE_STOP_DECEL * dt);
  }

  if (input.vyOverride != null) {
    s.vy = input.vyOverride;
  } else {
    if ((grounded || walkableSupport) && s.vy <= 0) {
      s.vy = 0;
    } else {
      s.vy = Math.max(s.vy + GRAVITY * dt, TERMINAL_VELOCITY);
    }
    if (nearGround && s.vy < NEAR_GROUND_FALL_SPEED_CAP) {
      s.vy = NEAR_GROUND_FALL_SPEED_CAP;
    }

    if (input.jump && (grounded || walkableSupport) && !onSlideSlope && s.vy <= 0) {
      s.vy = JUMP_IMPULSE;
    }
  }

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

  // Substepped sweeps; between substeps the body teleports to the corrected
  // spot (invisible — physics steps after this), then is restored and moved
  // kinematically so dynamic-body interactions see proper velocities.
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
