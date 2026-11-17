// ── Sewers ─────────────────────────────────────────────────────────────────
export const SEWER_LATTICE_REACH = 4;
export const SEWER_NODE_ROAD_FIELD = 3;
export const SEWER_STREET_SAMPLE = 4;
export const SEWER_DEPTH = 16;
export const PIPE_RADIUS = 4;
export const PIPE_AXIS_LIFT = 1.2;
export const CHANNEL_HALF = 1.4;
export const CHANNEL_DEPTH = 1.2;
/** The channel's air and liquid run this far past both ends of a pipe. */
export const CHANNEL_OVERRUN = CHANNEL_HALF;
export const LIQUID_BELOW_WALKWAY = 0.35;
/** The liquid's viscosity relative to water: divides the swim's speeds (physics/index.ts). */
export const SEWER_LIQUID_VISCOSITY = 2.5;
export const THROUGH_CHANCE = 0.5;
export const THROUGH_MIN = 5;
export const THROUGH_MAX = 9;
export const STRAIGHT_ON_CHANCE = 0.65;
export const THROUGH_FALLBACK_MIN = 3;
export const LOOP_LEAD_STREETS_MIN = 1;
export const LOOP_LEAD_STREETS_MAX = 2;
export const LOOP_FALLBACK_STREETS = 4;
export const SEWER_BRANCH_MIN = 2;
export const SEWER_BRANCH_MAX = 4;
export const SEWER_BRANCH_LENGTH_MIN = 1;
export const SEWER_BRANCH_LENGTH_MAX = 2;
export const ROOM_CHANCE = 0.35;
export const JUNCTION_HALF = 5;
export const JUNCTION_HEIGHT = 5.8;
export const ROOM_HALF = 13;
export const ROOM_HEIGHT = 10;
export const POOL_DEPTH = 5;
export const ROOM_WALKWAY = 3.5;
/** The default `chance` of <Rooms> in <Sewers>. */
export const SIDE_ROOM_CHANCE = 0.45;
/** The opening in the wall (the frame's jambs and lintel stand inside it, undergroundMeshes.ts buildDoor). */
export const DOOR_WIDTH = 2.4;
export const DOOR_HEIGHT = 3.8;
export const REVEAL_DEPTH = 0.4;
export const SIDE_ROOM_HALF = 3.5;
export const SIDE_ROOM_HEIGHT = 4.6;
export const SIDE_ROOM_SAMPLE = 1.75;
export const SIDE_ROOM_CLEAR = 0.3;
export const SIDE_ROOM_HEIGHTS = [0.3, 1, 2];
export const SHAFT_RADIUS = 1.2;
export const SHAFT_CORNER_IN = 2.3;
export const SHAFT_CEILING_OVERLAP = 0.5;
export const SHAFT_ABOVE_STREET = 0.8;
export const SHAFT_CLOSED_BELOW_STREET = 0.5;
export const MANHOLE_EXIT_OUT = 2.1;
export const MANHOLE_ASIDE_OUT = 2.75;
export const FRAME_INNER_RADIUS = 0.85;
export const FRAME_OUTER_RADIUS = 1.55;
export const FRAME_SAMPLES = 24;
export const FRAME_TOP_OVER_GROUND = 0.06;
export const COVER_RADIUS = 1.15;
export const COVER_THICKNESS = 0.08;
export const COVER_CLEARANCE = 0.04;
export const COVER_FIT_POINTS = 5;
/** Sewer colors (linear). */
export const SEWER_WALL_COLOR: readonly [number, number, number] = [0.08, 0.105, 0.15];
export const SEWER_WALKWAY_COLOR: readonly [number, number, number] = [0.1, 0.11, 0.13];
export const SEWER_SLIME_COLOR: readonly [number, number, number] = [0.16, 0.25, 0.12];
export const SEWER_GRAIN = 0.05;
export const PIPE_SLICE = 4;
export const SHAFT_SIDES = 16;
/** A terrain shaft hole is this much narrower than the shaft. */
export const SHAFT_HOLE_INSET = 0.3;
