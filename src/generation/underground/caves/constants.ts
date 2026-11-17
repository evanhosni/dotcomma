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
export const INNER_RADIUS_MIN = 6;
export const INNER_RADIUS_MAX = 7.5;

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
/** The patch's rock share fades in over this depth under the ground. */
export const PATCH_ROCK_FADE = 2.5;
