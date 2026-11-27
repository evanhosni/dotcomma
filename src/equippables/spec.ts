import { AK47_SPEC, REVOLVER_SPEC, ROCKET_LAUNCHER_SPEC, SWORD_SPEC } from "../weapons/spec";
import { ARM, HOLD } from "./enums";
import type { EquippableSpec } from "./types";

export const REVOLVER_EQUIPPABLE: EquippableSpec = {
  id: REVOLVER_SPEC.id,
  name: REVOLVER_SPEC.name,
  arms: [ARM.RIGHT],
  hold: HOLD.AIM,
  grip: [0, -0.012, -0.034],
  scale: 1,
  weapon: REVOLVER_SPEC.id,
};

export const AK47_EQUIPPABLE: EquippableSpec = {
  id: AK47_SPEC.id,
  name: AK47_SPEC.name,
  arms: [ARM.RIGHT, ARM.LEFT],
  hold: HOLD.AIM,
  grip: [0, -0.03, 0],
  scale: 1,
  reach: 0.45,
  view: [0.14, -0.17, -0.3],
  weapon: AK47_SPEC.id,
};

export const SWORD_EQUIPPABLE: EquippableSpec = {
  id: SWORD_SPEC.id,
  name: SWORD_SPEC.name,
  arms: [ARM.RIGHT],
  hold: HOLD.AIM,
  grip: [0, 0, 0],
  scale: 1,
  view: [0.22, -0.22, -0.32],
  weapon: SWORD_SPEC.id,
};

export const ROCKET_LAUNCHER_EQUIPPABLE: EquippableSpec = {
  id: ROCKET_LAUNCHER_SPEC.id,
  name: ROCKET_LAUNCHER_SPEC.name,
  arms: [ARM.RIGHT, ARM.LEFT],
  hold: HOLD.AIM,
  grip: [0, 0, 0],
  scale: 1,
  reach: 0.4,
  view: [0.2, -0.26, -0.2],
  weapon: ROCKET_LAUNCHER_SPEC.id,
};

/** Every equippable, by id. */
export const EQUIPPABLES: Readonly<Record<string, EquippableSpec>> = Object.fromEntries(
  [REVOLVER_EQUIPPABLE, AK47_EQUIPPABLE, SWORD_EQUIPPABLE, ROCKET_LAUNCHER_EQUIPPABLE].map((e) => [e.id, e]),
);

/** What a player carries from the start (the wheel's choices). */
export const STARTING_EQUIPPABLES: readonly string[] = [REVOLVER_EQUIPPABLE.id, AK47_EQUIPPABLE.id, SWORD_EQUIPPABLE.id, ROCKET_LAUNCHER_EQUIPPABLE.id];

export const equippableOf = (id: string): EquippableSpec | undefined => EQUIPPABLES[id];
