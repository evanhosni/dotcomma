

/** Camera far plane, world units. The outermost terrain LOD ring (world/terrain/lod/constants.ts) reaches
 *  exactly this far, and the ground's far fade ends here (world/shaders/material.ts). */
export const CAMERA_FAR = 7200;

/** Radians the look stops short of straight up or down: 89.9° of pitch each way. */
export const CAMERA_PITCH_MARGIN = (0.1 * Math.PI) / 180;

/** A worker sample older than this is given up on (lost to a worker reset). */
export const SAMPLE_GIVE_UP_MS = 1000;

/** The clip each player action plays (PlayerBody.tsx). A name the model lacks logs `animation "<name>" does
 *  not exist` once (animation/AnimationPlayer.ts) and holds the last pose: that is the list of clips to add. */
export const PLAYER_CLIPS = {
  idle: "idle",
  walk: "walk",
  walkBack: "walk back",
  strafeLeft: "strafe left",
  strafeRight: "strafe right",
  run: "run",
  jump: "jump",
  fall: "fall",
  slide: "slide",
  swim: "swim",
  tread: "tread water",
  climb: "climb",
  fly: "fly",
} as const;

/** u/s the beeble's walk clip covers at speed 1 (its NPC walks at 5 u/s, objects/actors/beeble/stateMachine.ts):
 *  the walk plays at the player's speed over this, so the feet keep up with the ground. */
export const WALK_CLIP_GROUND_SPEED = 5;
/** Below this horizontal speed (u/s) the player is standing. */
export const PLAYER_MOVING_SPEED = 0.5;

/** Third person: the camera's distance behind the head, and how far it stays off whatever the boom hits. */
export const THIRD_PERSON_DISTANCE = 6;
export const THIRD_PERSON_WALL_MARGIN = 0.3;
/** The body's facing from its walking direction (radians, + = counterclockwise from above) per heading:
 *  backing up faces away from the walk, a strafe faces the look (a left strafe walks +90° from it). */
export const HEADING_FACING_OFFSET = {
  forward: 0,
  backward: Math.PI,
  left: -Math.PI / 2,
  right: Math.PI / 2,
} as const;
/** 1/s: how fast the body turns to its walking direction. */
export const BODY_TURN_RATE = 12;
/** The head turns toward the look up to this far from the body (radians). */
export const MAX_HEAD_TURN = (50 * Math.PI) / 180;
/** Over the shoulder: the camera sits this far beside and above the head, so the crosshair passes
 *  beside and over the body, never through it, as third-person games frame their character. */
export const THIRD_PERSON_SHOULDER = 1.8;
export const THIRD_PERSON_RISE = 0.8;
/** Looking at the body's FRONT: the look this far (radians) from its facing. With the mouse still for
 *  FRONT_VIEW_SECONDS while there, the head gives up turning after the look and faces forward, at the camera. */
export const FRONT_VIEW_ANGLE = (135 * Math.PI) / 180;
/** ...and the look tilted no more than this up or down: looking well up or down is not looking at its face. */
export const FRONT_VIEW_MAX_PITCH = (30 * Math.PI) / 180;
/** A centered head follows the look again once the look is within this of the body's facing (the camera
 *  back behind it), or the player moves. */
export const FRONT_VIEW_RELEASE_ANGLE = Math.PI / 2;
export const FRONT_VIEW_SECONDS = 1;
/** 1/s: how fast the head eases to its target yaw. */
export const HEAD_TURN_RATE = 8;
/** Standing in first person, the body turns in place (walking) once the look is this far from its facing
 *  and stops within IN_PLACE_TURN_DONE, at IN_PLACE_TURN_RATE: the NPC beeble's own thresholds
 *  (objects/actors/beeble/stateMachine.ts); until then only the head follows. */
export const IN_PLACE_TURN_START = Math.PI / 2;
export const IN_PLACE_TURN_DONE = Math.PI / 9;
export const IN_PLACE_TURN_RATE = 4;
/** What the crosshair is on: its ray's first hit, or the point this far along it when it hits nothing.
 *  The third-person head looks at it, and switching views keeps the crosshair on it. */
export const CROSSHAIR_AIM_FAR = 500;
/** Into third person, the crosshair target is aimed at along the crosshair at the smooth maximum
 *  (d^p + MIN^p)^(1/p) of its distance d and this: MIN right in front, the target itself from ~2 × MIN out. A
 *  near target is (or nearly is) under no third-person crosshair, and solving for it swung the camera sideways. */
export const VIEW_SWITCH_MIN_AIM = 10;
/** The smooth maximum's sharpness: higher hands over from MIN to the target's own distance more abruptly. */
export const VIEW_SWITCH_AIM_SHARPNESS = 4;
