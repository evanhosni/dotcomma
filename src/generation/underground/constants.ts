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
/** Opening and inner-end radii; full width over SECTION_FULL_SHARE of the section, then a linear taper. */
export const OPENING_RADIUS_MIN = 8;
export const OPENING_RADIUS_MAX = 11;
export const SECTION_FULL_SHARE = 0.6;
/** Past a tube's end its floor RISES at this into the round end cap, steeper than any joined piece, so
 *  the neighbour's floor wins across a joint: a flat cap floor left a 1.2u ledge under a mouth's
 *  climbing floor (Evan's cave at (-3604, -17706)). */
export const TUBE_CAP_FLOOR_RISE = 0.45;

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
/** How high over the section's floor the terrain is cut inside the footprint (world/shaders/terrain-holes/store.ts):
 *  the opening's crown (2 radii) and its hood, no more. A cut through the whole column opened a slot up
 *  the mountainside over a mouth under a steep slope (Evan: "the terrain can extend over the cave entrance"). */
export const MOUTH_HOLE_CAP_RADII = 2.5;
export const MOUTH_HOLE_CAP_PAD = 6;
/** Daylight: full this close to a mouth's axis point, gone by the far distance; sewers from a manhole. */
export const DAYLIGHT_MOUTH_NEAR = 6;
export const DAYLIGHT_MOUTH_FAR = 45;
export const DAYLIGHT_MANHOLE_NEAR = 1.5;
export const DAYLIGHT_MANHOLE_FAR = 14;
export const DAYLIGHT_GROUND_DEPTH = 6;
