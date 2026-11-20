// Tuned against GRAVITY = -100 (10× real): every acceleration here reads as ~10× its real-world value.

/** Share of the wheel's weight carried per unit of compression: the spring rests at 100 / 400 = 0.25u. */
export const SPRING_RATE = 400;
/** Of critical damping (2√SPRING_RATE): bouncy enough to feel the weight shift, settled in ~2 cycles. */
export const DAMPING_RATIO = 0.4;
/** An explicit damper over 1/dt reverses the motion it damps (a hitch frame): capped at this × 1/dt. */
export const MAX_DAMPING_PER_STEP = 0.9;
/** A spring force over this many times the wheel's weight is clipped (a landing from a jump). */
export const MAX_SPRING_LOAD = 8;

/** Steering angle, radians: full lock at a crawl, narrowing with speed (GTA's twitch-free highway steering). */
export const MAX_STEER_SLOW = 0.62;
export const MAX_STEER_FAST = 0.16;
/** Radians per second the wheel turns toward the input, and back to center when it is released. */
export const STEER_RATE = 2.6;
export const STEER_RETURN_RATE = 4.5;

/** Tire friction coefficient: base + handling × range. Over 1 because the lateral grip, not the
 *  spring, is what holds a corner at 10× gravity. */
export const GRIP_BASE = 1.1;
export const GRIP_HANDLING_RANGE = 0.7;
/** The share of a wheel's sideways slip its tire cancels per step, before the friction limit. */
export const LATERAL_STIFFNESS = 0.85;
/** Rear tires a little looser than the front: lift-off oversteer and easy drifts. */
export const REAR_GRIP = 0.9;
/** The rear's grip with the handbrake pulled: it swings out. */
export const HANDBRAKE_GRIP = 0.22;
/** u/s² the handbrake decelerates the locked wheels. */
export const HANDBRAKE_DECEL = 70;

/** Off the road: grip and top speed scale from these (offRoad 0) to 1 (offRoad 1). */
export const OFFROAD_GRIP_MIN = 0.55;
export const OFFROAD_SPEED_MIN = 0.45;
/** Extra rolling drag per u/s off the road at offRoad 0. */
export const OFFROAD_DRAG = 0.9;

/** Coasting deceleration, u/s² (engine braking + rolling resistance). */
export const COAST_DECEL = 9;
/** Forward speed under which S reverses (and W pulls away from reversing) instead of braking. */
export const REVERSE_SWITCH_SPEED = 2;
export const REVERSE_SPEED_RATIO = 0.35;
export const REVERSE_ACCEL_RATIO = 0.6;
/** Air drag per u/s of speed (the top speed is the engine curve's; this only rounds it off). */
export const AIR_DRAG = 0.0015;
/** u/s² pressed down per u/s of speed while on the ground: keeps fast cars planted over crests. */
export const DOWNFORCE = 0.25;

/** Rad/s a driven wheel off the ground spins at under full throttle (drawn only). */
export const FREE_WHEEL_SPIN = 12;

/** Rad/s² of yaw and pitch the keys give a car with no wheel on the ground (GTA's air control). */
export const AIR_STEER = 3;
export const AIR_PITCH = 2.5;

/** The tire forces act this far from the contact patch toward the center of mass' height: less body
 *  roll than a real car (1 = none), so cornering hard leans instead of tipping over. */
export const ROLL_REDUCTION = 0.6;

/** Upside-down (body up · world up under this) and slower than FLIP_STILL_SPEED for FLIP_RESET_SECONDS:
 *  set back on its wheels. */
export const FLIPPED_UP_DOT = 0.3;
export const FLIP_STILL_SPEED = 4;
export const FLIP_RESET_SECONDS = 1.5;
export const FLIP_RESET_LIFT = 1.5;

/** Step lengths the forces are integrated over (a hitch frame is longer; the world still steps it whole). */
export const MIN_STEP_SECONDS = 1 / 240;
export const MAX_STEP_SECONDS = 1 / 20;
