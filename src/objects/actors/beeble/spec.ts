/**
 * BEEBLE SPEC — the beeble's physical body, with no React/Three: the
 * descriptor (actor.tsx) mounts this capsule on the client and the SERVER
 * (entities/kinds.ts) simulates the same capsule. One source.
 */
export const BEEBLE_COLLIDER: { shape: "capsule"; radius: number; height: number } = {
  shape: "capsule",
  radius: 0.5,
  height: 2.4,
};
