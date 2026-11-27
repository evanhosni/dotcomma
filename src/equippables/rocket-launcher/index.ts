import type * as THREE from "three";
import { FLASH_SIZE, MUZZLE_FLASH_NAME } from "../../weapons/constants";
import { assembleEquippable } from "../utils";
import { MUZZLE, ROCKET_LENGTH, WARHEAD_LENGTH } from "./constants";
import { rocketGeometries, rocketLauncherGeometries } from "./geometry";

/** One rocket launcher to draw, the PLACEHOLDER until its GLB: the tube along +z. */
export const createRocketLauncher = (): THREE.Group => assembleEquippable("rocket-launcher", rocketLauncherGeometries(), MUZZLE);

/** One rocket in flight (weapons/rockets/), its nose at the origin along +z, its exhaust burning behind it
 *  (the flash sprite, always lit). */
export const createRocket = (): THREE.Group => {
  const rocket = assembleEquippable("rocket", rocketGeometries(), [0, 0, -WARHEAD_LENGTH - ROCKET_LENGTH - FLASH_SIZE * 0.9]);
  const flame = rocket.getObjectByName(MUZZLE_FLASH_NAME)!;
  flame.scale.setScalar(FLASH_SIZE * 1.6);
  flame.visible = true;
  return rocket;
};
