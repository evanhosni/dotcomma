import type { ARM, HOLD } from "./enums";

export type Arm = (typeof ARM)[keyof typeof ARM];
export type Hold = (typeof HOLD)[keyof typeof HOLD];

/**
 * Something a beeble can hold (spec.ts): Three-free, shared with the server (its id is what a player's
 * `move.wp` says it holds). How it is drawn is the client's (registry.ts: its model).
 */
export interface EquippableSpec {
  /** The wire id (`move.wp`); a weapon's is its WeaponSpec id (weapons/spec.ts). */
  id: string;
  /** Its name on the equip wheel. */
  name: string;
  /** The arms that hold it: one ([ARM.RIGHT]) or both. The item sits in the first one's hand. */
  arms: readonly Arm[];
  hold: Hold;
  /** The point of the item the hand closes on (its own space, u). */
  grip: readonly [number, number, number];
  /** Its size in the hand (1: as modelled). */
  scale: number;
  /** For a two-armed AIM: how far before the chest the hands meet (u). */
  reach?: number;
  /** First person: where it is drawn before the eye (camera space, u; weapons/constants.ts VIEW_OFFSET when
   *  unset). */
  view?: readonly [number, number, number];
  /** The weapon it fires (weapons/spec.ts id); none for a tool or a thing. */
  weapon?: string;
}
