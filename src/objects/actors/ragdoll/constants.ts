/** A bone gets a body of its own only when at least this many vertices follow it most, and a bone with no
 *  child bones only when its box is at least MIN_LEAF_PART_SIZE across: a finger rides its parent's body. */
export const MIN_PART_VERTICES = 12;
export const MIN_LEAF_PART_SIZE = 0.15;
/** Each part's box is its vertices' bounds scaled by this, so neighbouring boxes overlap less at the joints. */
export const PART_BOX_SCALE = 0.85;
/** The thinnest a part's box gets (half extent, u): a flat part would tunnel through the ground. */
export const MIN_PART_HALF_EXTENT = 0.05;
/** Body-like density (mass per u³), each part's mass clamped into [MIN_PART_MASS, MAX_PART_MASS]: the joints
 *  cannot hold parts whose masses differ by orders of magnitude (a beeble's head outweighed its fingers
 *  30,000×, and the solver flung the head off at ~800u/s). */
export const PART_DENSITY = 1;
export const MIN_PART_MASS = 0.15;
export const MAX_PART_MASS = 1;
/** No part moves faster than this (u/s, rad/s): a bad contact never launches a limb across the map. */
export const MAX_PART_SPEED = 25;
export const MAX_PART_SPIN = 25;
export const PART_FRICTION = 0.9;
/** Damping, so a limb settles instead of flailing at the joints (spherical: no angle limits). */
export const LINEAR_DAMPING = 0.3;
export const ANGULAR_DAMPING = 3;

/** Rapier interaction groups (memberships << 16 | filter): every part is in bit 15 and collides with
 *  everything but bit 15, so a ragdoll's parts never push each other apart at the joints. */
const RAGDOLL_GROUP = 0x8000;
export const RAGDOLL_COLLISION_GROUPS = ((RAGDOLL_GROUP << 16) | (0xffff & ~RAGDOLL_GROUP)) >>> 0;

/** A part that falls this far below where the ragdoll started went through the ground (a heightfield swapped
 *  under it): the ragdoll freezes where it is instead of falling forever. */
export const MAX_DROP = 20;

/** A synced actor's predicted limp (LiveModelActor.setRagdoll) lasts this long without the server's word. */
export const RAGDOLL_PREDICTION_MS = 3000;
