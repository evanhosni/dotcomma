// 0.02 let a fast glancing contact penetrate the terrain trimesh, and a sweep
// that STARTS inside a triangle passes through it (fall-through-the-map).
export const CONTROLLER_CONTACT_OFFSET = 0.08;
/** Rapier interaction groups (memberships << 16 | filter). Every character's capsule (the players', an NPC's
 *  kinematic body) is in bit 14 alone, colliding with everything: a ragdoll's parts leave it out of their
 *  filter (objects/actors/ragdoll/constants.ts), because a kinematic capsule walked into a corpse flung it away
 *  at the parts' top speed. */
export const CHARACTER_GROUP = 0x4000;
export const CHARACTER_COLLISION_GROUPS = ((CHARACTER_GROUP << 16) | 0xffff) >>> 0;
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
// A fall is also slowed AHEAD of the ground (physics/index.ts updateVertical):
// no step drops a capsule deeper than the near-ground band at any speed.
export const NEAR_GROUND_FALL_SPEED_CAP = -20;

/** u/s². Also the Rapier world gravity on the client (CustomCanvas) and the server (physicsWorld.ts). */
export const GRAVITY = -100;
/** Safe at any value: the ground look-ahead slows every fall before the ground, and MAX_MOVEMENT_PER_FRAME
 *  keeps every substep within MAX_SUBSTEP_DISTANCE (it also caps the server's 10Hz walkers at 80u/s). */
export const TERMINAL_VELOCITY = -300;
export const JUMP_IMPULSE = 40;
export const MAX_MOVEMENT_PER_FRAME = 8;
/** A rise that moved less than this share of its desired step hit a ceiling: the upward speed is dropped. */
export const CEILING_BLOCKED_FRACTION = 0.5;
/** Support stops a fall only with the gap under the capsule within this past the contact offset (a
 *  standing capsule reads the offset itself). */
export const SUPPORT_REST_GAP = 0.05;
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

// SWIMMING (input.swim): under water the capsule sinks slowly; each jump PRESS is a stroke up that
// SWIM_SINK_ACCEL bleeds back to the sink (holding does nothing), and a press with the head near the
// surface breaches out of it.
/** Fraction of the capsule's height under the surface before it swims rather than wades. */
export const SWIM_SUBMERGED_FRACTION = 0.6;
export const SWIM_SINK_SPEED = -3;
export const SWIM_SINK_ACCEL = 12;
/** A stroke's upward kick: decelerating at SWIM_SINK_ACCEL it rises about 2u (v² / 2a). */
export const SWIM_STROKE_IMPULSE = 7;
/** 1/s: how fast a dive's fall speed bleeds off to the sink speed. */
export const WATER_DRAG = 5;
/** Under JUMP_IMPULSE: enough to clear the surface by about a body height. */
export const SWIM_BREACH_IMPULSE = 32;
export const SWIM_HEAD_ABOVE_SURFACE = 0.35;
/** A fresh press breaches while the head is less than this under the surface. */
export const SWIM_BREACH_REACH = 1.5;
