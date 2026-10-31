/** Tunnel tunables (DECISIONS.md beside this file has the measurements behind them). Leaf module: no
 *  imports, so any pipeline module may read it at its top level. */

/** The roll a biome cell passes to hold a system. */
export const CAVE_CHANCE = 0.6;
export const SEWER_CHANCE = 0.75;
/** Systems remembered per thread; the oldest half goes when full. */
export const SYSTEM_CACHE_MAX = 512;

// ── The field ──────────────────────────────────────────────────────────────
/** A piece counts only inside its bounds padded by this (else as this far): a brick's pieces are a
 *  subset of the system's, and the field must read the same bits from any subset that holds the air. */
export const FIELD_REACH = 4.5;
/** Wall noise and floor bumps are drawn only this close to a wall. */
export const NOISE_SHELL = 3.5;
/** Blend width of the smooth junction where two paths of one system meet. */
export const JUNCTION_BLEND = 2.5;
/** A round tube's axis stands this many radii over its floor (the floor is the chord below it). */
export const AXIS_LIFT = 0.7;
/** The floor's half width over the tube's radius, at the axis lift: sqrt(1 − 0.7²). */
export const FLOOR_HALF_WIDTH = Math.sqrt(1 - AXIS_LIFT * AXIS_LIFT);
/** The wall bulge (fraction of the radius) and the floor bumps (u, under the 0.5u autostep). */
export const WALL_BULGE = 0.22;
export const FLOOR_BUMP = 0.35;
/** A mouth's ragged outline swings the radius up to this fraction. */
export const MOUTH_RIM_AMP = 0.24;

// ── Caves ──────────────────────────────────────────────────────────────────
/** The entry tries this many directions from its random base angle, evenly around. */
export const ENTRY_DIRECTIONS = 6;
export const MOUTH_SEARCH_STEP = 8;
export const MOUTH_SEARCH_MAX = 700;
export const MOUTH_BACK_STEP = 4;
export const MOUTH_BACK_MAX = 260;
export const MOUTH_SITE_CLEAR = 40;
/** The ground must climb this (rise/run) over MOUTH_CLIMB_RUN into the mountain at an opening. */
export const MOUTH_CLIMB_GRADE = 0.3;
export const MOUTH_CLIMB_RUN = 12;
export const HIGH_MOUTH_CHANCE = 0.6;
export const HIGH_MOUTH_RISE_MIN = 20;
export const HIGH_MOUTH_RISE_MAX = 100;
export const HIGH_MOUTH_CLIMB_MAX = 400;
/** A high mouth's spot is judged by the ground's grade over ±this along the ray, at most CLIMB_GRADE_MAX. */
export const CLIMB_GRADE_HALF_RUN = 4;
export const CLIMB_GRADE_MAX = 1;
export const OPENING_RADIUS_MIN = 8;
export const OPENING_RADIUS_MAX = 11;
export const PASSAGE_RADIUS_MIN = 6;
export const PASSAGE_RADIUS_MAX = 7.5;
/** A section descends at this grade (~11°) when planned; settled on the trunk's floor, a section
 *  steeper than MOUTH_STEEP_GRADE is no way in. */
export const SECTION_GRADE = 0.2;
export const MOUTH_STEEP_GRADE = 0.35;
export const SECTION_MIN = 20;
export const SECTION_MAX = 100;
export const SECTION_STEP = 8;
/** The opening keeps its full radius over this share of the section, then narrows. */
export const SECTION_FULL_SHARE = 0.6;
/** Rock kept over every crown (u), judged on the axis and on both flanks, this far past the bulged wall. */
export const ROCK_COVER = 4;
export const COVER_FLANK_PAD = 2;
/** Fitness: a road's paved half width plus this. */
export const MOUTH_ROAD_CLEAR = 12;
export const MOUTH_WATER_CLEAR = 0.5;
export const EXIT_CHANCE = 0.5;
export const EXIT_TRIES = 3;
export const EXIT_ANGLE_WANDER = 0.6;
export const EXIT_MIN_DISTANCE = 120;
/** Main path: the straight lead from each mouth and the sideways wander at the quarter points. */
export const TRUNK_LEAD = 30;

// ── Spring caves (caves.ts generateSpring) ─────────────────────────────────
/** The opening's floor this far under the river's surface (the water runs in), its radius the river's
 *  half-width plus SPRING_OPENING_PAD, between the usual opening radii and SPRING_OPENING_MAX. */
export const SPRING_SINK = 0.6;
export const SPRING_OPENING_PAD = 1.5;
export const SPRING_OPENING_MAX = 14;
/** Past the section a flooded lead this long, then the POOL ROOM: a capsule of SPRING_ROOM_LENGTH at
 *  SPRING_ROOM_RADIUS (SPRING_ROOM_RADIUS_MIN where the rock cover is short), its floor
 *  SPRING_POOL_DEPTH under the lead's. A spring whose lead ends within SPRING_SHARE_REACH of another
 *  spring's of the cell connects to it instead (no pool: one river runs through). */
export const SPRING_LEAD = 16;
export const SPRING_ROOM_LENGTH = 22;
export const SPRING_ROOM_RADIUS = 22;
export const SPRING_ROOM_RADIUS_MIN = 14;
export const SPRING_POOL_DEPTH = 3.5;
export const SPRING_SHARE_REACH = 170;
/** Two springs CONNECT instead (finishConnectedSpring): one river through a HALL between their leads, its floor
 *  SPRING_HALL_DEPTH under the water sloping between the two mouths' levels, whatever they are. */
export const SPRING_HALL_RADIUS = 13;
export const SPRING_HALL_DEPTH = 3;
/** How deep the water sheet draws the opening's and lead's strip (the river's own carved depth, so the
 *  water reads the same through the opening; the strip's real floor is 0.6–1.1u under). */
export const SPRING_STRIP_DEPTH = 2.5;
/** How far around a spring's water the terrain's water sheet dives UNDER it instead of under the
 *  mountain (springWater.ts): past the coarsest quad the sheet is drawn into near a cave (LOD3, 70u). */
export const SPRING_WATER_MARGIN = 72;
/** A spring's section descends only this gently: the river's water fills it, and it stays wadeable with its crown in the air. */
export const SPRING_SECTION_GRADE = 0.05;
/** The standing water sits this far under the river's surface (never level with its sheet). */
export const SPRING_WATER_BELOW_SURFACE = 0.05;
export const TRUNK_WANDER = [25, 50, 25];
export const LOOP_LEAD_MIN = 20;
export const LOOP_LEAD_MAX = 40;
export const LOOP_RADIUS_MIN = 45;
export const LOOP_RADIUS_MAX = 85;
export const LOOP_POINTS = 8;
export const LOOP_JITTER = 0.2;
export const LOOP_AIM = 0.4;
export const PATH_STEP = 8;
export const PASSAGE_SWELL_MIN = 5;
export const PASSAGE_SWELL_MAX = 10;
export const PASSAGE_WAVES = [37, 17];
export const PASSAGE_WAVE_WEIGHTS = [0.6, 0.4];
export const MOUTH_RAMP_START = 4;
export const MOUTH_RAMP_END = 22;
export const FLOOR_SWELL = 3;
export const FLOOR_SWELL_WAVE_MIN = 140;
export const FLOOR_SWELL_WAVE_MAX = 260;
/** The floor swell fades in over this far from a mouth's inner end. */
export const FLOOR_SWELL_RAMP = 40;
/** A loop's junction and its last sample settle onto one floor in at most this many relax passes. */
export const JUNCTION_SETTLE_PASSES = 8;
export const FLOOR_GRADE = 0.3;
/** Past its ends a tube's floor RISES this much per unit into its round cap (~24°: walkable, steeper than any
 *  piece joined there — MOUTH_STEEP_GRADE, FLOOR_GRADE). Flat at the end's level, the cap of the first tube
 *  reached ~5u back under its mouth, whose floor climbs toward the opening: a 1.2u ledge (50° at its worst)
 *  a player dropped down on the way in and could not climb on the way out (Evan, the cave at (-3604, -17706)). */
export const TUBE_CAP_FLOOR_RISE = 0.45;
export const BRANCH_COUNT_MIN = 2;
export const BRANCH_COUNT_MAX = 4;
export const BRANCH_TRIES = 4;
export const BRANCH_END_CLEAR = 25;
export const BRANCH_TURN_MIN = 0.9;
export const BRANCH_TURN_MAX = 1.7;
export const BRANCH_LENGTH_MIN = 35;
export const BRANCH_LENGTH_MAX = 90;
export const BRANCH_WANDER = 0.15;
/** A branch's curve passes through this many wandering points along its length. */
export const BRANCH_CONTROL_POINTS = 3;
export const BRANCH_RADIUS_MIN = 3.6;
export const BRANCH_RADIUS_MAX = 7.2;
export const BRANCH_WAVES = [23, 11];
export const BRANCH_EASE = 12;
export const BRANCH_FLOOR_WALK = 0.4;
export const BRANCH_AIR_CLEAR = 3;
export const BRANCH_MIN_LENGTH = 16;
export const ROOM_TRUNK_CHANCE = 0.5;
export const ROOM_TIP_CHANCE = 0.35;
export const ROOM_MOUTH_CLEAR = 40;
export const ROOM_TRIES = 4;
export const ROOM_RADIUS_MIN = 12;
export const ROOM_RADIUS_MAX = 18;
export const ROOM_LENGTH_MIN = 6;
export const ROOM_LENGTH_MAX = 16;
export const ROOM_HEADING = 0.6;
export const ROOM_AIR_CLEAR = 3;
export const FORMATION_STEP = 4;
export const ROOM_FORMATION_TRIES = 3;
export const STALACTITE_CHANCE = 0.4;
export const STALACTITE_SPREAD = 0.65;
export const STALACTITE_LENGTH_MIN = 1.5;
export const STALACTITE_LENGTH_MAX = 5;
export const STALACTITE_ROOM_LENGTH = 9;
export const STALACTITE_RADIUS_MIN = 0.9;
export const STALACTITE_RADIUS_MAX = 2.6;
export const STALACTITE_HEADROOM = 3.2;
export const STALAGMITE_CHANCE = 0.25;
export const STALAGMITE_MIN_HALF_WIDTH = 2.8;
export const STALAGMITE_PLACE_MIN = 0.5;
export const STALAGMITE_PLACE_MAX = 0.85;
export const STALAGMITE_HEIGHT_MIN = 1;
export const STALAGMITE_HEIGHT_MAX = 3.5;
export const STALAGMITE_ROOM_HEIGHT = 5;
export const STALAGMITE_RADIUS_MIN = 0.7;
export const STALAGMITE_RADIUS_MAX = 1.8;
export const STALAGMITE_CEILING_CLEAR = 2;
/** A formation is rooted this far into the rock the probe finds, probing from FORMATION_PROBE_LIFT over
 *  the floor; one shorter than FORMATION_MIN_LENGTH is dropped. */
export const FORMATION_ROOT = 2.5;
export const FORMATION_PROBE_LIFT = 1.5;
export const FORMATION_PROBE_STEP = 1;
export const FORMATION_PROBE_MAX = 30;
export const FORMATION_MIN_LENGTH = 0.5;
/** A skirt mask covers at most this much of a path. */
export const MASK_RUN = 24;

// ── Mouth rocks (consumed by the rock dressing) ────────────────────────────
export const RIM_GRID = 2;
export const RIM_FRONT = 6;
export const RIM_SIDE_PAD = 4;
export const RIM_ROCK_CHANCE = 0.75;
export const RIM_ROCK_RISE = 1.6;
export const RIM_ROCK_SIZE_MIN = 0.8;
export const RIM_ROCK_SIZE_MAX = 3.4;
export const RIM_ROCK_SETBACK = 0.45;
export const RIM_ROCK_SPACING = 2.8;
export const STREWN_MIN = 10;
export const STREWN_MAX = 18;
export const STREWN_SIZE_MIN = 0.8;
export const STREWN_SIZE_MAX = 5;
export const STREWN_REACH_RADII = 3;
export const STREWN_FRONT_SHARE = 0.6;
export const STREWN_APPROACH_IN = 0.5;
export const STREWN_APPROACH_PAD = 2;
export const STREWN_SPACING_PAD = 1;
export const STREWN_TRIES = 30;

// ── The mouth bulge (the one height step) ─────────────────────────────────
export const BULGE_HEIGHT = 0.9;
export const BULGE_REACH = 9;
export const BULGE_FLOOR_STRIP_PAD = 1;
export const BULGE_FLOOR_STRIP_FADE = 5;
export const BULGE_RELIFT_LOW = 0.5;
export const BULGE_RELIFT_HIGH = 3;
/** The hood over a section rises to the crown + rock over this many opening radii from the opening (1 raised a
 *  near-vertical face the mountain material painted as a rock crescent over every entrance: Evan, "smoothed and
 *  better blended"), shouldered off beside the outline over HOOD_SHOULDER local radii. */
export const HOOD_RISE = 1.6;
export const HOOD_CROWN_ROCK = 0.3;
export const HOOD_SHOULDER = 7;
export const HOOD_TAIL = 5;
export const LEDGE_SINK = 0.08;
export const LEDGE_OUT = 1.5;
export const LEDGE_SIDE = 1.1;
export const LEDGE_FADE_IN = 0.3;
export const LEDGE_ROUND = 1;
export const BULGE_ROAD_PAD = 4;
export const BULGE_ROAD_FADE = 8;
/** A mouth's reach on the ground: the mound's, which is the widest. */
export const BULGE_MAX_REACH = BULGE_REACH * OPENING_RADIUS_MAX + HOOD_TAIL * OPENING_RADIUS_MAX + SECTION_MAX;
export const MOUTH_TILE = 128;
export const MOUTH_TILE_CACHE_MAX = 4096;
/** Nothing grows (foliage, snow) this far around a mouth's section: the widest outline plus this
 *  many radii plus the pad. */
export const KEEP_OFF_RADII = 0.9;
export const KEEP_OFF_PAD = 3;

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
/** The liquid's viscosity relative to water: divides the swim's speeds (physics/characterMovement.ts). */
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
/** <SewerSideRoom>'s default `chance`. */
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

// ── Meshing ────────────────────────────────────────────────────────────────
export const BRICK = 16;
export const VOXEL = 1;
/** A wall standing more than this over the drawn ground is neither drawn nor solid. */
export const GROUND_CUT_SLACK = 0.05;
/** Triangles split to about this edge length before the ground cut clips them. */
export const GROUND_CUT_SPLIT = 0.75;
/** A mouth's footprint: the capsule along its section this much wider than its widest outline. */
export const FOOTPRINT_PAD = 3;
/** The terrain's cut inside a footprint stops this far inside it (the overlap band the patch covers). */
export const FOOTPRINT_BAND = 1.5;
/** How high over the section's floor the terrain is cut inside the footprint (world/shaders/terrainHoles.ts):
 *  the opening's crown (2 radii) and its hood, no more. A cut through the whole column opened a slot up
 *  the mountainside over a mouth under a steep slope (Evan: "the terrain can extend over the cave entrance"). */
export const MOUTH_HOLE_CAP_RADII = 2.5;
export const MOUTH_HOLE_CAP_PAD = 6;
/** The patch's rock share fades in over this depth under the ground. */
export const PATCH_ROCK_FADE = 2.5;
/** Daylight: full this close to a mouth's axis point, gone by the far distance; sewers from a manhole. */
export const DAYLIGHT_MOUTH_NEAR = 6;
export const DAYLIGHT_MOUTH_FAR = 45;
export const DAYLIGHT_MANHOLE_NEAR = 1.5;
export const DAYLIGHT_MANHOLE_FAR = 14;
export const DAYLIGHT_GROUND_DEPTH = 6;
/** Cave colors (linear). */
export const CAVE_WALL_COLOR: readonly [number, number, number] = [0.4, 0.4, 0.43];
export const CAVE_FLOOR_COLOR: readonly [number, number, number] = [0.33, 0.3, 0.27];
export const CAVE_FLOOR_UP_START = 0.2;
export const CAVE_FLOOR_UP_END = 0.85;
export const CAVE_GRAIN = 0.12;
/** Sewer colors (linear). */
export const SEWER_WALL_COLOR: readonly [number, number, number] = [0.08, 0.105, 0.15];
export const SEWER_WALKWAY_COLOR: readonly [number, number, number] = [0.1, 0.11, 0.13];
export const SEWER_SLIME_COLOR: readonly [number, number, number] = [0.16, 0.25, 0.12];
export const SEWER_GRAIN = 0.05;
export const PIPE_SLICE = 4;
export const SHAFT_SIDES = 16;
/** A terrain shaft hole is this much narrower than the shaft. */
export const SHAFT_HOLE_INSET = 0.3;
