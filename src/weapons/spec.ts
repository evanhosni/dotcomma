/**
 * The weapons: Three-free, shared with the server, which validates every shot against them (rate, reach)
 * and applies the damage. A weapon is held as an EQUIPPABLE (equippables/spec.ts: its arms, its model) that
 * names it; firing it is WeaponDriver.tsx's.
 */
export interface WeaponSpec {
  /** The wire id (`move.wp`, `shoot.weapon`). */
  id: string;
  /** Its name on the weapon wheel. */
  name: string;
  /** Health taken by one hit. */
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  /** Farthest a shot hits anything (u). */
  range: number;
  /** The radius of the hole a bullet leaves, entering and leaving a body (u). */
  woundRadius: number;
}

export const REVOLVER_SPEC: WeaponSpec = {
  id: "revolver",
  name: "revolver",
  damage: 100,
  fireInterval: 0.5,
  range: 150,
  woundRadius: 0.09,
};

/** Every weapon, by id. */
export const WEAPONS: Readonly<Record<string, WeaponSpec>> = { [REVOLVER_SPEC.id]: REVOLVER_SPEC };

export const weaponOf = (id: string): WeaponSpec | undefined => WEAPONS[id];
