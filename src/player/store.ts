import { PLAYER_DETECTABILITY, PLAYER_HEALTH } from "./spec";
import type { PlayerBodyState, PlayerPlacement, ScreenSide } from "./types";

/** How far the camera hangs behind the player's head along the look: 0 in first person (Player.tsx). */
let cameraBoom = 0;

export const getCameraBoom = (): number => cameraBoom;
export const setCameraBoom = (distance: number): void => {
  cameraBoom = distance;
};

/** Where the body sits on screen in third person (the camera looks over the OTHER shoulder). A player
 *  setting: the settings menu will call the setter. */
let thirdPersonBodySide: ScreenSide = "left";

export const getThirdPersonBodySide = (): ScreenSide => thirdPersonBodySide;
export const setThirdPersonBodySide = (side: ScreenSide): void => {
  thirdPersonBodySide = side;
};

/** How noticeable the local player is to NPCs (spec.ts PLAYER_DETECTABILITY), by its form. */
export const getLocalDetectability = (): number => PLAYER_DETECTABILITY[localBody?.form ?? "host"];

/** The local player's drawn pose, written by Player.tsx every frame: what LocalPlayerSync publishes. */
let localBody: PlayerBodyState | null = null;

export const getLocalPlayerBody = (): PlayerBodyState | null => localBody;
export const setLocalPlayerBody = (body: PlayerBodyState | null): void => {
  localBody = body;
};

/** The local player's host's health (the server's: net/players/store.ts player:hurt). */
let health = PLAYER_HEALTH;
const healthListeners = new Set<(health: number, hurt: boolean) => void>();

export const getLocalHealth = (): number => health;
export const setLocalHealth = (next: number): void => {
  const hurt = next < health;
  health = next;
  healthListeners.forEach((fn) => fn(next, hurt));
};
export const onLocalHealth = (fn: (health: number, hurt: boolean) => void): (() => void) => {
  healthListeners.add(fn);
  return () => {
    healthListeners.delete(fn);
  };
};

/** While held, the Player does nothing but pose its body: a cutscene owns the camera, the position the
 *  network sees (GameContext playerPosition) and the body state (the overworld's intro). Its capsule is off. */
let held = false;

export const isPlayerHeld = (): boolean => held;
export const setPlayerHeld = (h: boolean): void => {
  held = h;
};

/** Where a cutscene leaves the player: taken by the Player on its next frame. */
let placement: PlayerPlacement | null = null;

export const placePlayer = (p: PlayerPlacement): void => {
  placement = p;
};
export const takePlayerPlacement = (): PlayerPlacement | null => {
  const p = placement;
  placement = null;
  return p;
};
