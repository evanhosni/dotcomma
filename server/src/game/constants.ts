

export const SAVE_INTERVAL_MS = 30_000;

/** Own module so physics/physicsWorld.ts and server/src/game/entities/EntityManager.ts can both import it without a cycle. */
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
/** One tick as a simulation step: the physics world's timestep and every machine's `delta`. */
export const TICK_SECONDS = TICK_MS / 1000;
