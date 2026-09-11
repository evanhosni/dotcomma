/** The world tick rate — every synced actor's state machine and the server
 *  physics step run at this cadence (index.ts). Its own module so the physics
 *  world and the entity manager can both import it without a cycle. */
export const TICK_HZ = 10;
export const TICK_MS = 1000 / TICK_HZ;
