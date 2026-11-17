

/** Frames between a local ground actor's surface samples on the dressing worker (the Player's cadence). */
export const SURFACE_SAMPLE_INTERVAL = 6;

// Past ActorPool's MAX_MOUNTS_PER_BATCH (20), so a despawn+respawn wave of one model finds every clone parked.
export const MAX_POOLED_PER_KEY = 24;
/** Rest-pose bounds slack so an animated pose isn't culled. */
export const SKINNED_BOUNDS_PAD = 1.5;
