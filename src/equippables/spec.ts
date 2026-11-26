import { REVOLVER_SPEC } from "../weapons/spec";
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

/** Every equippable, by id. */
export const EQUIPPABLES: Readonly<Record<string, EquippableSpec>> = { [REVOLVER_EQUIPPABLE.id]: REVOLVER_EQUIPPABLE };

/** What a player carries from the start (the wheel's choices). */
export const STARTING_EQUIPPABLES: readonly string[] = [REVOLVER_EQUIPPABLE.id];

export const equippableOf = (id: string): EquippableSpec | undefined => EQUIPPABLES[id];
