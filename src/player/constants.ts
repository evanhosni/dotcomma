

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
/** 1/s: how fast the body turns to its walking direction in third person. */
export const BODY_TURN_RATE = 12;
/** The head turns toward the look up to this far from the body (radians). */
export const MAX_HEAD_TURN = (50 * Math.PI) / 180;
/** Over the shoulder: the camera sits this far beside and above the head, so the crosshair passes
 *  beside and over the body, never through it, as third-person games frame their character. */
export const THIRD_PERSON_SHOULDER = 1.8;
export const THIRD_PERSON_RISE = 0.8;
/** Looking at the body's FRONT: the look this far (radians) from its facing. Held FRONT_VIEW_SECONDS, with
 *  the head held still for as long (within HEAD_SETTLED of where it is turning), the head gives up turning
 *  after the look and faces forward, at the camera: a head that turned and centered at once looked wrong. */
export const FRONT_VIEW_ANGLE = (135 * Math.PI) / 180;
export const FRONT_VIEW_SECONDS = 1;
export const HEAD_SETTLED = (3 * Math.PI) / 180;
/** 1/s: how fast the head eases to its target yaw. */
export const HEAD_TURN_RATE = 8;
