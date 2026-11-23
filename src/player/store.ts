import type { ScreenSide } from "./types";

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
