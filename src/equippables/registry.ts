import type * as THREE from "three";
import { createRevolver } from "./revolver";
import { EQUIPPABLES, REVOLVER_EQUIPPABLE } from "./spec";

/** Each equippable's model, by id: a fresh one per hand that holds it (and the first-person view). Its own
 *  space: the grip (EquippableSpec.grip) where the hand closes, its forward +z, its up +y. A GLB's loader
 *  goes here when the placeholder is replaced. */
export const EQUIPPABLE_MODELS: Readonly<Record<string, () => THREE.Object3D>> = {
  [REVOLVER_EQUIPPABLE.id]: createRevolver,
};

/** Every equippable has a model (dev: a missing one is a content mistake, tests/equippables.test.ts). */
export const unmodelledEquippables = (): string[] => Object.keys(EQUIPPABLES).filter((id) => !EQUIPPABLE_MODELS[id]);
