

/** Client and server MUST chunk identically: belt-freeway coverage depends on the query center's wall set. */
export const WORLD_CHUNK_SIZE = 256;

/** Thin street furniture only needs to be solid where the player can reach it. */
export const CHUNK_COLLIDER_DISTANCE = 90;

export const UPDATE_INTERVAL_FRAMES = 31;

// One budgeted queue across every streamed system, so a ring of fresh chunks can't stack mesh
// assembly into one frame.
// Weight 1.5: at equal distance a building or the ground comes first; beyond 400u a chunk is background.
// CHUNK_REQUESTS_IN_FLIGHT: a chunk's task awaits its worker; one at a time, every feature's chunks (lamps,
// markers, rocks, snow, particles, bridges, tunnels) waited out one round trip after another, the worker
// idling between them (PERFORMANCE.md "Outrunning the generators again").
export const CHUNK_REQUESTS_IN_FLIGHT = 4;
export const CHUNK_QUEUE_WEIGHT = 1.5;

/** Chunks are dropped this far past the render distance, so chunk borders don't thrash. */
export const DROP_HYSTERESIS = 1.3;
