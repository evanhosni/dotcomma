/** Per lattice point, what `land` says (ROAD / BANK: not land, beside road or riverbank; LAND; KEEPS:
 *  land that keeps its piece by itself) and the verdict of a land point's piece (STAYS, or removed
 *  TO_ROAD / TO_BANK, by what most of its rim borders). */
export const ROAD = 0;
export const LAND = 1;
export const KEEPS = 2;
export const STAYS = 2;
export const TO_ROAD = 1;
export const TO_BANK = 3;
export const BANK = 4;
export const RAMP = 5;
