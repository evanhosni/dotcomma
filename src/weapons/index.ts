import type * as THREE from "three";
import { FLASH_SECONDS, MUZZLE_FLASH_NAME } from "./constants";

/** When each weapon model's flash goes out (s). */
const flashUntil = new WeakMap<THREE.Object3D, number>();

/** Shows a weapon model's muzzle flash (its MUZZLE_FLASH_NAME sprite) from `now` (s) for FLASH_SECONDS, at a
 *  random turn. */
export const flashMuzzle = (model: THREE.Object3D, now: number): void => {
  const flash = model.getObjectByName(MUZZLE_FLASH_NAME) as THREE.Sprite | undefined;
  if (!flash) return;
  flash.material.rotation = Math.random() * Math.PI * 2;
  flash.visible = true;
  flashUntil.set(model, now + FLASH_SECONDS);
};

/** Hides a flash whose time is up; call every frame the model is drawn. */
export const settleMuzzle = (model: THREE.Object3D, now: number): void => {
  if (now < (flashUntil.get(model) ?? 0)) return;
  const flash = model.getObjectByName(MUZZLE_FLASH_NAME);
  if (flash) flash.visible = false;
};
