import type * as THREE from "three";
import { PLAYER_CLIPS, PLAYER_MOVING_SPEED, WALK_CLIP_GROUND_SPEED } from "./constants";
import { getCameraBoom } from "./store";
import type { PlayerActionSample, PlayerBodyState } from "./types";

/** Quarter steps: a speed that changed every frame would re-anchor the channel every frame. */
const quantizeSpeed = (speed: number): number => Math.max(0.25, Math.round(speed * 4) / 4);

/** The clip for what the player is doing, written into `out` (clip, clipSpeed, loop). */
export const playerAnimationOf = (s: PlayerActionSample, out: PlayerBodyState): void => {
  const moving = s.speed > PLAYER_MOVING_SPEED;
  out.loop = "repeat";
  out.clipSpeed = 1;
  if (s.noclip) out.clip = PLAYER_CLIPS.fly;
  else if (s.climbing) out.clip = PLAYER_CLIPS.climb;
  else if (s.swimming) out.clip = moving ? PLAYER_CLIPS.swim : PLAYER_CLIPS.tread;
  else if (s.jumped && s.vy > 0) {
    out.clip = PLAYER_CLIPS.jump;
    out.loop = "once";
  } else if (s.airborne) out.clip = PLAYER_CLIPS.fall;
  else if (s.sliding) out.clip = PLAYER_CLIPS.slide;
  else if (!moving) out.clip = s.turningInPlace ? PLAYER_CLIPS.walk : PLAYER_CLIPS.idle;
  else if (s.sprint) out.clip = PLAYER_CLIPS.run;
  else {
    out.clip = PLAYER_CLIPS.walk;
    out.clipSpeed = quantizeSpeed(s.speed / WALK_CLIP_GROUND_SPEED);
  }
};

/** THE interaction ray (everything the crosshair picks: actors, doors, manholes, the CRT): the screen
 *  center's ray, started where it passes the player's head instead of at the camera. In third person
 *  reach is then measured from the player, as in other third-person games, and the player's own body,
 *  behind the origin, never blocks it. */
export const aimFromCamera = (camera: THREE.Camera, out: THREE.Ray): THREE.Ray => {
  camera.getWorldPosition(out.origin);
  camera.getWorldDirection(out.direction);
  out.origin.addScaledVector(out.direction, getCameraBoom());
  return out;
};
