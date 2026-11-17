/**
 * MOVEMENT MODIFIERS: what the ground does to a capsule's step — one object every capsule (the
 * player, local actors, server NPCs) reads, filled by every surface SOURCE in turn (the snow today;
 * mud, ice, wind later = one more fold in vertexCompute's surfaceModifiersAt). Speed factors multiply,
 * slope bonuses add, clamped to ±SLOPE_BONUS_LIMIT. Sampled OFF the stepping thread and handed in as
 * CharacterInput.surface (physics/README.md). Three-free.
 */
import type { MovementModifiers, SurfaceFetch, SurfaceSampler } from "./types";

/** The ground probe stops reading ground as ground past ~60°; the 40° slide angle + 15° stays under it. */
export const SLOPE_BONUS_LIMIT = (15 * Math.PI) / 180;

export const createMovementModifiers = (): MovementModifiers => ({ speedFactor: 1, slopeBonus: 0, snowDepth: 0 });

export const resetMovementModifiers = (m: MovementModifiers): void => {
  m.speedFactor = 1;
  m.slopeBonus = 0;
  m.snowDepth = 0;
};

export const copyMovementModifiers = (into: MovementModifiers, from: MovementModifiers): void => {
  into.speedFactor = from.speedFactor;
  into.slopeBonus = from.slopeBonus;
  into.snowDepth = from.snowDepth;
};

/** Folds one source's share in. */
export const combineMovementModifiers = (into: MovementModifiers, speedFactor: number, slopeBonus: number): void => {
  into.speedFactor *= speedFactor;
  into.slopeBonus = Math.max(-SLOPE_BONUS_LIMIT, Math.min(SLOPE_BONUS_LIMIT, into.slopeBonus + slopeBonus));
};

export const createSurfaceSampler = (interval: number, fetch: SurfaceFetch): SurfaceSampler => {
  const modifiers = createMovementModifiers();
  let step = 0;
  let pending = false;
  return {
    modifiers,
    sample(x, z, feetY) {
      if (++step % interval !== 0 || pending) return;
      pending = true;
      fetch(x, z, feetY, (m) => {
        if (m !== null) copyMovementModifiers(modifiers, m);
        pending = false;
      });
    },
    reset() {
      resetMovementModifiers(modifiers);
    },
  };
};
