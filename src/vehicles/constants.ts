/** The chase camera (GTA): it trails the car's heading, the mouse orbits it, and a few seconds after
 *  the mouse stops it swings back behind. */
export const CHASE_DISTANCE = 9;
/** Extra boom per u/s: the car pulls away from the camera as it speeds up. */
export const CHASE_DISTANCE_PER_SPEED = 0.03;
export const CHASE_TARGET_HEIGHT = 2;
/** Radians above the horizon the boom sits at. */
export const CHASE_PITCH = 0.22;
export const CHASE_PITCH_MIN = -0.35;
export const CHASE_PITCH_MAX = 1.2;
/** 1/s: how fast the camera's heading catches the car's. */
export const CHASE_FOLLOW_RATE = 4;
/** 1/s the boom length eases at. */
export const CHASE_DISTANCE_RATE = 3;
/** Radians per pixel of mouse movement. */
export const ORBIT_SENSITIVITY = 0.003;
/** Seconds after the last mouse move before the orbit swings back, and 1/s it swings at. */
export const ORBIT_RETURN_DELAY = 1.5;
export const ORBIT_RETURN_RATE = 2.5;
/** The camera stops this short of whatever the boom hits. */
export const CHASE_CLEARANCE = 0.4;

/** Frames between ground samples of the driven car (on a road, or off it, and the fall backstop). */
export const GROUND_SAMPLE_INTERVAL = 8;
/** The car's origin (its wheels' contact plane) this far under the drawn ground: lifted back onto it. */
export const SINK_TOLERANCE = 2;
/** Above the ground after a backstop lift. */
export const SINK_LIFT = 1;

/** The player steps out this far to the side of the seat, and this high (body center). */
export const EXIT_SIDE = 2.8;
export const EXIT_HEIGHT = 1.2;
/** No room either side: out on the roof. */
export const EXIT_ROOF_HEIGHT = 3.2;
