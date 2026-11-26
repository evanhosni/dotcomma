/** The MAV Unit hovers this far above the ground before it falls: ~10s of fall, long enough for the ground
 *  under it to load. */
export const DROP_HEIGHT = 1500;

// The title, written in the sky under the hovering unit (only this player's camera sees it). Sizes are in
// units of its depth below the camera, so it reads as the old landing page did whatever the depth: the
// title a quarter of a view height above the centre, the prompt at the centre.
export const TITLE_DEPTH = 30;
export const TITLE_WIDTH = 0.75;
export const TITLE_ABOVE_CENTER = 0.245;
export const PROMPT_WIDTH = 0.44;
/** The type sizes (canvas px of a LABEL_CANVAS_WIDTH-wide label). public/index.html's copy of the title is laid
 *  out from these (IntroOverlay.ts layoutTitle); change one, change both. */
export const TITLE_FONT_PX = 112;
export const PROMPT_FONT_PX = 84;

/** A sky label's canvas is at least this wide; its world width is its `width` at this many pixels (the type's
 *  scale). */
export const LABEL_CANVAS_WIDTH = 1024;
export const LABEL_CANVAS_HEIGHT = 256;
/** px of canvas left free on each side of the text. */
export const LABEL_PADDING = 48;
/** The text's middle sits this many type sizes above the label's centre (the font's ascent outweighs its
 *  descent). The page's copy of the title (IntroOverlay.ts) places its lines by it too. */
export const LABEL_MIDDLE_LIFT = 0.18;
/** Drawn over everything, the sky's black (just under it) included. */
export const LABEL_RENDER_ORDER = 10001;

export const PROMPT_ENTER = "- click to enter -";
export const PROMPT_SCANNING = "- scanning for host -";
/** A rescan's first message: the host died. */
export const PROMPT_HOST_LOST = "- host lost -";
export const PROMPT_FOUND = "- host found -";
/** An address with no free beeble in its cell: the scan widens to the places around it. */
export const PROMPT_EXPANDING = "- no host found. expanding scan -";
/** No free beeble anywhere near: the player falls as one already wearing its unit. */
export const PROMPT_NONE = "- no host found -";

// The scan for a host. It always runs at least SCAN_MIN_SECONDS, flicking the address bar through places,
// which is also time for the ground under the host to start loading.
export const SCAN_MIN_SECONDS = 2.6;
export const SCAN_FLICKER_SECONDS = 0.09;
/** How far the flicker's random places range from the start. */
export const SCAN_FLICKER_RANGE = 6000;
/** The scan gives up after this long: the player falls as a beeble already wearing its unit. */
export const SCAN_TIMEOUT_SECONDS = 15;
export const HOST_FOUND_SECONDS = 2;
/** Every scan message stays up at least this long (Intro.tsx showPrompt). */
export const PROMPT_MIN_SECONDS = 2;
/** Each place searched: the beebles standing within this radius of it, on the surface (a tunnel's stand
 *  under it, more than HOST_SURFACE_TOLERANCE below the ground). */
export const HOST_SEARCH_RADIUS = 220;
/** An address is searched first on its own: every free beeble this far from its cell's site that stands in
 *  that very cell (a biome cell is ~gridSize 500 across). */
export const ADDRESS_SEARCH_RADIUS = 400;
export const HOST_SURFACE_TOLERANCE = 3;
/** Places searched after the start: rings of six more per ring, RING_STEP apart. */
export const HOST_SEARCH_RINGS = 5;
export const HOST_RING_STEP = 450;
/** The nearest few beebles of a place are tried in turn: another player may hold a claim on one. */
export const HOST_CANDIDATES = 6;
/** A claim unanswered this long is granted with no connection, refused with one (utils.ts claimHost). */
export const CLAIM_TIMEOUT_MS = 2500;

// The fall (u, s). The prompt and title pass the camera within the first second.
export const FALL_ACCELERATION = 140;
/** Under the network's relocation threshold (net/players/LocalPlayerSync.tsx TELEPORT_SPEED). */
export const FALL_MAX_SPEED = 340;
/** The last stretch is a dive: the speed climbs by up to this fraction over the final DIVE_HEIGHT, into the
 *  impact (well under LocalPlayerSync's relocation threshold, 800u/s). */
export const DIVE_HEIGHT = 200;
export const DIVE_BOOST = 0.25;
/** A unit that must stop at HOLD_HEIGHT (its host not ready) brakes this hard (u/s²) instead of halting. */
export const HOLD_BRAKE = 400;
/** The unit waits at this height until the ground and its host are there, and its host has passed the
 *  sky test: a ray from its head straight up to the unit meets nothing solid (a bridge, an overhang, a
 *  building). The colliders around the host exist only this close, never during the scan; they get
 *  SKY_TEST_SETTLE_SECONDS after the host appears to be built. */
export const HOLD_HEIGHT = 140;
export const SKY_TEST_SETTLE_SECONDS = 0.6;
/** Held over the same host this long (it never mounted, never passed, the ground never came): it is refused
 *  and another is found. */
export const HOLD_GIVE_UP_SECONDS = 6;
/** The unit is locked over its host the whole fall (an eased homing lagged behind a walking host, then
 *  caught up in jumps): over its feet, moving onto the top of its head over the last SEAT_BLEND_HEIGHT (the
 *  head bobs as it walks; the feet glide). A change of target (a refused host, a host first mounted) is
 *  glided over in at least TRACK_GLIDE_SECONDS, longer for a long way (TRACK_GLIDE_SPEED u/s). */
export const SEAT_BLEND_HEIGHT = 20;
export const TRACK_GLIDE_SECONDS = 0.8;
export const TRACK_GLIDE_SPEED = 250;
/** "host found" waits this long at most for the host to be mounted here, so the fall tracks it from the start. */
export const HOST_MOUNT_WAIT_SECONDS = 8;
/** The unit turns slowly as it falls (rad/s): what other players see. */
export const FALL_SPIN = 0.6;
export const BLACK_FADE_DELAY = 0.4;
export const BLACK_FADE_SECONDS = 4;
export const SCAN_RAMP_START = 0.6;
export const SCAN_RAMP_END = 3;
/** Past this the title has gone by: its meshes are removed. */
export const TITLE_GONE_SECONDS = 3;
/** The unit falls straight down through the title and only then turns toward its host: below the title by
 *  this much, the MAV reticle appears and the homing starts. */
export const BELOW_TITLE = 2;
/** Where a beeble's head top roughly is over its feet before its head has been seen (a host not mounted yet). */
export const HEAD_TOP_GUESS = 1.9;
/** The unit has landed once its screw's tip is within LANDING_TOLERANCE above its goal and LANDING_RADIUS of
 *  it across. */
export const LANDING_TOLERANCE = 0.01;
export const LANDING_RADIUS = 0.25;

// Screwing in.
/** The host takes the hit before the screw starts turning. */
export const KNOCK_SECONDS = 0.5;
export const SCREW_SECONDS = 3.5;
export const SCREW_TURNS = 5;
/** The camera rises out of the unit to this height above it, looking down at the head it screws into: along
 *  the unit's axis tipped toward the sky by INSTALL_CAMERA_SKYWARD (a host fallen head-first points the axis
 *  into the ground), never lower than CAMERA_GROUND_CLEARANCE over the ground. */
export const INSTALL_CAMERA_HEIGHT = 3;
export const INSTALL_CAMERA_SKYWARD = 1.5;
export const CAMERA_GROUND_CLEARANCE = 0.4;
export const CAMERA_FOLLOW_RATE = 5;
export const FADE_OUT_SECONDS = 0.9;

// Waking in the host. The eyelids' openness (0 shut, 1 open) at times after the screen went black.
export const BLINKS: readonly [number, number][] = [
  [0, 0],
  [0.8, 0],
  [1.3, 0.35],
  [1.6, 0.05],
  [2.0, 0.05],
  [2.5, 0.6],
  [2.75, 0.15],
  [3.0, 0.15],
  [3.6, 1],
];
/** Seconds the blinking takes. */
export const BLINK_SECONDS = BLINKS[BLINKS.length - 1][0];
/** Getting up must not take longer than this (the server's word lost): the player stands regardless. */
export const STAND_TIMEOUT_SECONDS = 8;

/** A host's death: the view holds over its fall this long before the rescan starts. */
export const DEATH_HOLD_SECONDS = 2;
