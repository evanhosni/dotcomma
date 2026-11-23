/**
 * MOVEMENT MODIFIERS: what the ground does to a capsule's step — one object every capsule (the
 * player, local actors, server NPCs) reads, filled by every ground SOURCE in turn (the snow today;
 * mud, ice later = one SURFACE_MOVEMENT entry and one fold in vertexCompute's surfaceModifiersAt). Every
 * kind is a pair of multipliers (constants.ts). Sampled OFF the stepping thread and handed in as
 * CharacterInput.surface (physics/README.md); the liquids are known on the stepping side and fold in
 * there (CharacterInput.swim). Three-free.
 */
import { SURFACE_MOVEMENT } from "./constants";
import type { MovementModifiers, SurfaceFetch, SurfaceKind, SurfaceSampler } from "./types";

export const createMovementModifiers = (): MovementModifiers => ({ speedFactor: 1, slopeFactor: 1, snowDepth: 0 });

export const resetMovementModifiers = (m: MovementModifiers): void => {
  m.speedFactor = 1;
  m.slopeFactor = 1;
  m.snowDepth = 0;
};

export const copyMovementModifiers = (into: MovementModifiers, from: MovementModifiers): void => {
  into.speedFactor = from.speedFactor;
  into.slopeFactor = from.slopeFactor;
  into.snowDepth = from.snowDepth;
};

/** Folds one kind of ground in. */
export const combineMovementModifiers = (into: MovementModifiers, kind: SurfaceKind): void => {
  const { speed, slope } = SURFACE_MOVEMENT[kind];
  into.speedFactor *= speed;
  into.slopeFactor *= slope;
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
