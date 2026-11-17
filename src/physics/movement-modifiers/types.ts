export interface MovementModifiers {
  /** Multiplies the walk speed (1 = neutral). */
  speedFactor: number;
  /** Added to every slope limit (radians): the uphill fade's start and end and the slide angle. */
  slopeBonus: number;
  /** The snow depth under the capsule (0 = none). */
  snowDepth: number;
}

/** Answers one surface sample OFF the stepping thread (the dressing worker, the server's chunk
 *  generator): `answer` gets the modifiers, or null when none came (a worker not up yet, a reset) and
 *  the last answer stands. May call back synchronously or later. */
export type SurfaceFetch = (x: number, z: number, feetY: number, answer: (m: MovementModifiers | null) => void) => void;

/** A capsule's surface sampler: every `interval` steps one request, never two in flight, the last
 *  answer kept in `modifiers` — the object handed in as CharacterInput.surface. */
export interface SurfaceSampler {
  readonly modifiers: MovementModifiers;
  /** Per step, at the capsule's feet. */
  sample(x: number, z: number, feetY: number): void;
  /** Neutral ground again (a teleport, a domain switch). */
  reset(): void;
}
