/** THE CHANNEL's kinds and defaults (./index.ts): the bodies whose water is carved in the ground, the
 *  walls each cuts, and <Banks/>, the part that shapes their levees. Three-free. */

import { POND_KIND, RIVERS } from "../params";
import type { BankReliefParams, WallShape } from "../types";

/** The bodies whose water is a CHANNEL carved in the ground: what <Banks/> shapes. */
export const CHANNEL_BODY_KINDS = [RIVERS, POND_KIND] as const;

/** Every channel's walls unless its body says otherwise. They ease into the natural ground from `wallEase`
 *  to `wallReach` past the water band; the field reads walls out to the widest reach mounted
 *  (generation/water/rivers/field/index.ts riverWallRead), so a reach never steps where it stops. 440 (the field's own support)
 *  left a face wherever the ground stood high over the water: 300u of cut eased back over 320u
 *  (generation/water/DECISIONS.md "The valleys and the wide walls"). */
export const WALL_DEFAULTS: WallShape = { wallGrade: 0.6, wallEase: 120, wallReach: 1000 };

/** <Banks/>: the share of the biome's noise a levee takes, and the same noise again 3× finer at 0.8 — at
 *  the biome's own wavelengths the relief read as one smooth swell over a 36u bank (generation/water/DECISIONS.md "A
 *  levee bank takes its biome's noise") — gated by the drop the bank is held over. */
export const BANKS = "banks";
export const BANK_DEFAULTS: BankReliefParams = { share: 0.7, fineScale: 3, fineShare: 0.8, dropStart: 2, dropFull: 12, dropScale: 25, dropCap: 50 };
