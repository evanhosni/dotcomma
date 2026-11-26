/** The most bullet channels a body keeps (each an entry and an exit hole in the shader's uniform array):
 *  past it, the oldest heal over. */
export const MAX_WOUNDS = 32;
/** The holes the shader cuts: an entry and an exit per channel. */
export const MAX_HOLES = MAX_WOUNDS * 2;
/** The most channels one shot leaves (in and out of an arm, then of the chest). */
export const MAX_WOUNDS_PER_SHOT = 2;
/** The most bodies one bullet goes through (it stops only at a solid surface of the world). */
export const MAX_SHOT_HITS = 16;
/** Blood stains the body out to this many wound radii around each hole. */
export const BLOOD_RING = 2.2;
/** A body lies dead this long (s) before it is gone: an NPC retired for every player, a player's corpse
 *  removed on each client. */
export const CORPSE_SECONDS = 90;
/** The killing shot throws the body along the bullet (a change of velocity, u/s): the part it hit takes
 *  KILL_PUSH, every part KILL_CARRY of it (the whole body goes, not just a limb). An NPC's (server) and a
 *  player's corpse alike. */
export const KILL_PUSH = 7;
export const KILL_CARRY = 0.5;
/** Each later shot at a corpse shoves it along the bullet the same way, softer. */
export const CORPSE_PUSH = 6;
export const CORPSE_CARRY = 0.45;
