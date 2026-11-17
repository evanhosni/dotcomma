/** Consumed by the spawn system only. ONE list drives both the ActorProps
 *  Omit and the pool's runtime strip, so they can't drift. */
export const SPAWN_ONLY_KEYS = [
  "density",
  "footprint",
  "clustering",
  "priority",
  "spacingOverrides",
  "immediateRadius",
  "biomeIds",
  "feature",
  "zone",
  "heightRange",
  "slopeRange",
  "roadDistanceRange",
  "flattenGround",
  "flattenRadius",
  "flattenSkirt",
  "spriteLod",
] as const;
