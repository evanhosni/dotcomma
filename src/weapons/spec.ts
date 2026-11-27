/**
 * The weapons: Three-free, shared with the server, which validates every shot against them (rate, reach)
 * and applies the damage. A weapon is held as an EQUIPPABLE (equippables/spec.ts: its arms, its model) that
 * names it; firing it is WeaponDriver.tsx's.
 */

/** How a weapon strikes (weapons/README.md): a BULLET goes through every body on the crosshair's ray, leaving
 *  wounds; a BLADE slices whatever its swing's plane crosses within reach; a BLAST is a rocket that flies and
 *  bursts every body near where it explodes into chunks. */
export type WeaponAttack = "bullet" | "blade" | "blast";

export interface WeaponSpec {
  /** The wire id (`move.wp`, `shoot.weapon`). */
  id: string;
  /** Its name on the weapon wheel. */
  name: string;
  attack: WeaponAttack;
  /** Health taken by one hit. */
  damage: number;
  /** Seconds between shots. */
  fireInterval: number;
  /** Held down, it keeps firing. */
  automatic?: boolean;
  /** Farthest a shot hits anything (u): a bullet's ray, a blade's reach from the eye, a rocket's flight. */
  range: number;
  /** The radius of the hole a bullet leaves, entering and leaving a body (u). */
  woundRadius: number;
  /** A blast's reach from where it explodes (u): every body within it bursts. */
  blastRadius?: number;
  /** Blood sprayed per body hit (bursts: vfx/blood/). */
  blood: number;
}

export const REVOLVER_SPEC: WeaponSpec = {
  id: "revolver",
  name: "revolver",
  attack: "bullet",
  damage: 100,
  fireInterval: 0.5,
  range: 150,
  woundRadius: 0.09,
  blood: 2,
};

export const AK47_SPEC: WeaponSpec = {
  id: "ak47",
  name: "ak-47",
  attack: "bullet",
  damage: 34,
  fireInterval: 0.1,
  automatic: true,
  range: 150,
  woundRadius: 0.05,
  blood: 3,
};

/** One swing kills: a cut body is dead (a living one would get up with a limb gone). */
export const SWORD_SPEC: WeaponSpec = {
  id: "sword",
  name: "sword",
  attack: "blade",
  damage: 1000,
  fireInterval: 0.45,
  range: 2.6,
  woundRadius: 0,
  blood: 6,
};

export const ROCKET_LAUNCHER_SPEC: WeaponSpec = {
  id: "rocket-launcher",
  name: "rocket launcher",
  attack: "blast",
  damage: 1000,
  fireInterval: 1.2,
  range: 200,
  woundRadius: 0,
  blastRadius: 4.5,
  blood: 8,
};

/** Every weapon, by id. */
export const WEAPONS: Readonly<Record<string, WeaponSpec>> = Object.fromEntries(
  [REVOLVER_SPEC, AK47_SPEC, SWORD_SPEC, ROCKET_LAUNCHER_SPEC].map((w) => [w.id, w]),
);

export const weaponOf = (id: string): WeaponSpec | undefined => WEAPONS[id];
