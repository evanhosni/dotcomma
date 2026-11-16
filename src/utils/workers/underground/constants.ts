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
/** Rock kept over every crown (a cave passage's, a sewer's ceiling). */
export const ROCK_COVER = 4;
/** The default `trunkChance` / `tipChance` of <Rooms> in <Caves>. */
export const ROOM_TRUNK_CHANCE = 0.5;
export const ROOM_TIP_CHANCE = 0.35;

/** The entry mouth: tried along MOUTH_RAYS evenly spaced rays from the cell's site (from a random base
 *  angle), each walked out in MOUTH_SEARCH_STEP steps until it leaves the biome (at most
 *  MOUTH_SEARCH_REACH), then back in by MOUTH_FOOT_STEP to the first FOOT: ground rising
 *  MOUTH_FOOT_GRADE over MOUTH_FOOT_RUN. */
export const MOUTH_RAYS = 6;
export const MOUTH_SEARCH_STEP = 4;
export const MOUTH_SEARCH_REACH = 900;
export const MOUTH_FOOT_STEP = 2;
export const MOUTH_FOOT_GRADE = 0.3;
export const MOUTH_FOOT_RUN = 12;
/** A mouth stands at least this far from the cell's site. */
export const MOUTH_SITE_CLEAR = 40;
/** High mouths: this share of entries first climbs on up its ray (at most HIGH_MOUTH_CLIMB) to
 *  HIGH_MOUTH_RISE over the foot, opening at the first spot no steeper than HIGH_MOUTH_GRADE along the
 *  ray whose section fits, no higher than HIGH_MOUTH_RISE_MAX; else the foot (180u targets mostly
 *  overshot the flanks). */
export const HIGH_MOUTH_CHANCE = 0.6;
export const HIGH_MOUTH_RISE_MIN = 20;
export const HIGH_MOUTH_RISE_MAX = 100;
export const HIGH_MOUTH_GRADE = 1;
/** The grade a high mouth stands on is read over this either side of it along the ray (the mountain's
 *  bumps are steep over a few units). */
export const HIGH_MOUTH_GRADE_RUN = 6;
export const HIGH_MOUTH_CLIMB = 400;
/** Fit ground for a mouth: this far over any water, this far past a road's or freeway's half width. */
export const MOUTH_WATER_CLEAR = 0.5;
export const MOUTH_ROAD_CLEAR = 12;
/** A mouth's straight SECTION into the mountain: the shortest length (MIN to MAX in STEP steps) whose inner
 *  end keeps ROCK_COVER over its bulged crown, on the axis and on both flanks COVER_FLANK_PAD past the
 *  bulged wall, its floor descending at MOUTH_GRADE; fit ground is required every SECTION_FIT_STEP along it. */
export const SECTION_LENGTH_MIN = 20;
export const SECTION_LENGTH_MAX = 100;
export const SECTION_LENGTH_STEP = 8;
export const SECTION_FIT_STEP = 4;
export const MOUTH_GRADE = 0.2;
/** A settled section steeper than this is no way in. */
export const MOUTH_STEEP_GRADE = 0.35;
/** The exit: this chance, roughly opposite the entry (± EXIT_TURN rad, EXIT_TRIES rays), at a foot only,
 *  at least EXIT_CLEAR from the entry. */
export const EXIT_CHANCE = 0.5;
export const EXIT_TURN = 0.6;
export const EXIT_TRIES = 3;
export const EXIT_CLEAR = 120;
/** Every cover check (a section's inner end, a path sample, a room) reads the ground on both flanks this
 *  far past the bulged wall as well as on the axis. */
export const COVER_FLANK_PAD = 2;
/** Opening and inner-end radii; full width over SECTION_FULL_SHARE of the section, then a linear taper. */
export const OPENING_RADIUS_MIN = 8;
export const OPENING_RADIUS_MAX = 11;
export const INNER_RADIUS_MIN = 6;
export const INNER_RADIUS_MAX = 7.5;
export const SECTION_FULL_SHARE = 0.6;

/** Paths are sampled every PATH_STEP (4u put ~7 consecutive tubes inside every sample's bounds, and the
 *  chunk took 20% longer). */
export const PATH_STEP = 8;
/** A trunk with an exit: a straight lead out of each mouth, then a bow wandering up to this far sideways
 *  at its quarter points. */
export const TRUNK_LEAD = 30;
export const BOW_WANDER: readonly number[] = [25, 50, 25];
/** A trunk without one: a lead to a junction, then a jittered ring of LOOP_POINTS beside it, back to the
 *  junction; the junction's two visits are settled onto one floor in LOOP_SETTLE_ROUNDS rounds. */
export const LOOP_LEAD_MIN = 20;
export const LOOP_LEAD_MAX = 40;
export const LOOP_POINTS = 8;
export const LOOP_RADIUS_MIN = 45;
export const LOOP_RADIUS_MAX = 85;
export const LOOP_JITTER = 0.2;
export const LOOP_SETTLE_ROUNDS = 4;
/** The trunk's radius swells between these: 0.6 sin(u / 37 + p1) + 0.4 sin(u / 17 + p2) (fixed
 *  wavelengths, drawn phases). From each mouth's inner end ONE ramp, smoothstep(RADIUS_EASE_START,
 *  RADIUS_EASE_END) of the distance to it, eases the radius out of the mouth's inner radius and brings in
 *  the wall lumps and the floor bumps. */
export const PASSAGE_RADIUS_MIN = 5;
export const PASSAGE_RADIUS_MAX = 10;
export const PASSAGE_WAVES: readonly [number, number] = [37, 17];
export const RADIUS_EASE_START = 4;
export const RADIUS_EASE_END = 22;
/** Floors: rise over run never past FLOOR_GRADE (the highest floor the rock allows climbed at the full
 *  grade for hundreds of units under a peak); the trunk aims at the line between its inner floors with a
 *  ±FLOOR_SWELL swell over a FLOOR_WAVE wave, faded in over FLOOR_SWELL_FADE from the mouths. */
export const FLOOR_GRADE = 0.3;
export const FLOOR_SWELL = 3;
export const FLOOR_WAVE_MIN = 140;
export const FLOOR_WAVE_MAX = 260;
export const FLOOR_SWELL_FADE = 40;
/** Past a tube's end its floor RISES at this into the round end cap, steeper than any joined piece, so
 *  the neighbour's floor wins across a joint: a flat cap floor left a 1.2u ledge under a mouth's
 *  climbing floor (Evan's cave at (-3604, -17706)). */
export const TUBE_CAP_FLOOR_RISE = 0.45;
/** Blind branches off the trunk, leaving it BRANCH_END_CLEAR from its ends. */
export const BRANCH_MIN = 2;
export const BRANCH_MAX = 4;
export const BRANCH_TRIES = 4;
export const BRANCH_END_CLEAR = 25;
export const BRANCH_TURN_MIN = 0.9;
export const BRANCH_TURN_MAX = 1.7;
export const BRANCH_LENGTH_MIN = 35;
export const BRANCH_LENGTH_MAX = 90;
export const BRANCH_WANDER = 0.15;
export const BRANCH_RADIUS_MIN = 3.6;
export const BRANCH_RADIUS_MAX = 7.2;
export const BRANCH_WAVES: readonly [number, number] = [23, 11];
/** A branch's floor steps up or down this share of FLOOR_GRADE per unit of run (a fair coin each sample). */
export const BRANCH_FLOOR_WALK = 0.4;
export const BRANCH_EASE = 12;
/** A branch ended shorter than this is dropped. */
export const BRANCH_SHORTEST = 16;
/** A branch or room keeps this much rock from another path's air. */
export const PATH_CLEARANCE = 3;
/** Side rooms (<Rooms>): one on the trunk ROOM_MOUTH_CLEAR from both mouths (ROOM_TRIES), one at each branch tip. */
export const ROOM_MOUTH_CLEAR = 40;
export const ROOM_TRIES = 4;
export const ROOM_RADIUS_MIN = 12;
export const ROOM_RADIUS_MAX = 18;
export const ROOM_LENGTH_MIN = 6;
export const ROOM_LENGTH_MAX = 16;
export const ROOM_TURN = 0.6;
/** Formations, from the decoration stream: tried every FORMATION_STEP along every path past
 *  FORMATION_MOUTH_CLEAR from a mouth, ROOM_FORMATION_TRIES times per spot along a room. */
export const FORMATION_STEP = 4;
export const FORMATION_MOUTH_CLEAR = 22;
export const ROOM_FORMATION_TRIES = 3;
export const STALACTITE_CHANCE = 0.4;
export const STALACTITE_LENGTH_MIN = 1.5;
export const STALACTITE_LENGTH_MAX = 5;
export const ROOM_STALACTITE_LENGTH_MAX = 9;
export const STALACTITE_RADIUS_MIN = 0.9;
export const STALACTITE_RADIUS_MAX = 2.6;
/** A stalactite hangs within this share of the floor's half width of the axis, its tip at least
 *  STALACTITE_TIP_CLEAR over the floor. */
export const STALACTITE_SPREAD = 0.65;
export const STALACTITE_TIP_CLEAR = 3.2;
export const STALAGMITE_CHANCE = 0.25;
export const STALAGMITE_HEIGHT_MIN = 1;
export const STALAGMITE_HEIGHT_MAX = 3.5;
export const ROOM_STALAGMITE_HEIGHT_MAX = 5;
export const STALAGMITE_RADIUS_MIN = 0.7;
export const STALAGMITE_RADIUS_MAX = 1.8;
/** A stalagmite needs this floor half width, stands this share of the way toward a wall, and keeps
 *  STALAGMITE_CEILING_CLEAR under the ceiling. */
export const STALAGMITE_MIN_HALF_WIDTH = 2.8;
export const STALAGMITE_WALL_MIN = 0.5;
export const STALAGMITE_WALL_MAX = 0.85;
export const STALAGMITE_CEILING_CLEAR = 2;
/** Every formation roots this deep in the rock it was found on, and stands at least FORMATION_SHORTEST in the air. */
export const FORMATION_ROOT = 2.5;
export const FORMATION_SHORTEST = 0.5;
/** Skirt masks cover runs of at most this many path segments (24u). */
export const MASK_RUN_SEGMENTS = 3;

// ── Mouth rocks (consumed by the rock dressing) ────────────────────────────
/** A mouth's rocks scatter over a rectangle about its opening: along the section from FRONT_SHARE of the
 *  reach (REACH_RADII opening radii) in front to the farther of the reach and the section's end, across
 *  to the farther of the reach and the widest outline + SIDE_PAD. */
export const MOUTH_ROCK_REACH_RADII = 3;
export const MOUTH_ROCK_FRONT_SHARE = 0.6;
export const MOUTH_ROCK_SIDE_PAD = 4;
/** A RIM point has a neighbour this far away (±along, ±across) in the opening and is always kept; any
 *  other point at FAR_KEEP, so the rocks cluster on the outline with a sparser scatter beyond. */
export const MOUTH_ROCK_GRID = 2;
export const MOUTH_ROCK_FAR_KEEP = 0.25;
/** Sizes: SIZE_MIN + (SIZE_MAX − SIZE_MIN)·u³ (biased small). */
export const MOUTH_ROCK_SIZE_MIN = 0.8;
export const MOUTH_ROCK_SIZE_MAX = 5;
/** Over the section no rock stands where the ground is under this over its floor (the passage floor). */
export const MOUTH_ROCK_RISE = 1.6;
/** A rim rock is set back outward by this share of its size. */
export const MOUTH_ROCK_SETBACK = 0.45;
/** The approach stays clear: within APPROACH_IN opening radii in, beside the opening ± size + APPROACH_PAD. */
export const MOUTH_ROCK_APPROACH_IN = 0.5;
export const MOUTH_ROCK_APPROACH_PAD = 2;
/** Rocks keep their sizes plus this apart. */
export const MOUTH_ROCK_SPACING_PAD = 1;
export const MOUTH_ROCK_TRIES = 30;
/** Rocks per mouth, set so the rock dressing DRAWS (after its own filters) about what the old rim and
 *  strewn rules drew: 9.85 per mouth over the first 20 mountain mouths against 9.6 (DECISIONS.md "One
 *  mouth-rock rule"). */
export const MOUTH_ROCK_COUNT_MIN = 12;
export const MOUTH_ROCK_COUNT_MAX = 16;

// ── The mouth bulge (the one height step) ─────────────────────────────────
/** The MOUND: a cosine bump MOUND_HEIGHT opening radii high over MOUND_RADIUS radii around each opening,
 *  held off the walking strip in front — the floor's half width + MOUND_STRIP_IN, released by + MOUND_STRIP_OUT
 *  (u) — while the ground there stands under MOUND_FLOOR_NEAR over the floor, released by MOUND_FLOOR_FAR (u). */
export const MOUND_HEIGHT = 0.9;
export const MOUND_RADIUS = 9;
export const MOUND_STRIP_IN = 1;
export const MOUND_STRIP_OUT = 6;
export const MOUND_FLOOR_NEAR = 0.5;
export const MOUND_FLOOR_FAR = 3;
/** The HOOD: from the opening it rises over HOOD_RISE opening radii to the bulged crown (WALL_BULGE)
 *  plus HOOD_ROCK local radii of rock; full over the widest outline (MOUTH_RIM_AMP and WALL_BULGE both
 *  swung out), shouldered off over HOOD_SHOULDER local radii beside it, trailing off over HOOD_TAIL
 *  opening radii past the inner end. Never lowers the ground.
 *  A rise over 1 radius painted a gray crescent of rock over every snowy entrance (DECISIONS.md "A
 *  gentler hood"); 0.5 radii stood a cliff the LOD1 lattice could not draw. */
export const HOOD_RISE = 1.6;
export const HOOD_ROCK = 0.3;
export const HOOD_SHOULDER = 7;
export const HOOD_TAIL = 5;
/** The LEDGE in front: the ground levelled LEDGE_DROP under the floor over LEDGE_LENGTH radii out and
 *  LEDGE_HALF_WIDTH radii either side, fading in from the opening's plane over LEDGE_FADE_IN radii and
 *  rounding into the slope over LEDGE_ROUND radii. Levelled exactly to the floor it z-fought the cave's
 *  floor; starting right at the plane it dug into the rim. */
export const LEDGE_DROP = 0.08;
export const LEDGE_LENGTH = 1.5;
export const LEDGE_HALF_WIDTH = 1.1;
export const LEDGE_FADE_IN = 0.3;
export const LEDGE_ROUND = 1;
/** The bulge is nothing under water and within BULGE_MASK_PAD past a road's, freeway's or river's
 *  keep-off, full BULGE_MASK_FADE further: cached road and deck data agree whether or not it was there. */
export const BULGE_MASK_PAD = 4;
export const BULGE_MASK_FADE = 8;
/** The farthest a bulge reaches from its section: the mound of the widest opening. */
export const BULGE_MAX_REACH = MOUND_RADIUS * OPENING_RADIUS_MAX;
/** The terrain looks mouths up per tile of this size (the tiles kept before the oldest half goes). */
export const MOUTH_TILE = 128;
export const MOUTH_TILES_MAX = 4096;
/** Growth keeps off a section by its widest outline + KEEP_OFF_RADII opening radii + KEEP_OFF_PAD. */
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
/** Sewer colors (linear). */
export const SEWER_WALL_COLOR: readonly [number, number, number] = [0.08, 0.105, 0.15];
export const SEWER_WALKWAY_COLOR: readonly [number, number, number] = [0.1, 0.11, 0.13];
export const SEWER_SLIME_COLOR: readonly [number, number, number] = [0.16, 0.25, 0.12];
export const SEWER_GRAIN = 0.05;
export const PIPE_SLICE = 4;
export const SHAFT_SIDES = 16;
/** A terrain shaft hole is this much narrower than the shaft. */
export const SHAFT_HOLE_INSET = 0.3;
