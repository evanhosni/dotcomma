/** The river system's shared dimensions and piece codes (each module keeps its own tunables). Leaf
 *  module: imports nothing from the pipeline but the live config, so any top-level value may read it. */

import { domainConfig } from "../computeConfig";

/** A junction's width factor never exceeds this (the ocean boost's cap). */
export const RIVER_WIDTH_MAX = 2.4;
/** End shapes: a pond is the capsule end fattened over its last POND_LENGTH; a fizzle thins to
 *  FIZZLE_FACTOR over its last FIZZLE_LENGTH only (a whole-edge taper read as a ditch). */
export const RIVER_POND_FACTOR = 1.7;
export const RIVER_POND_LENGTH = 100;
export const RIVER_FIZZLE_FACTOR = 0.12;
export const RIVER_FIZZLE_LENGTH = 300;
/** Steep ground that is NOT the mountain's rock (grade, ridge, hillside) does not break a river over
 *  a gap up to this long whose both sides are river or water — two stretches of one river, or a
 *  stretch and the sea it runs into, so rivers connect to the water near them (over a 40 km square
 *  this covers ~80% of such gaps). Needed because the region bases (desert 260u over 1800u, snow 600u
 *  over 4000u) alone exceed the grade and hillside limits. */
export const RIVER_GAP_FILL = 800;
/** The channel is measured from a meandered query point (±10u over ~90u), so a straight edge winds. */
export const RIVER_MEANDER_AMP = 10;
export const RIVER_MEANDER_SCALE = 90;
/** Smooth-minimum support between DIFFERENT rivers (factor-1 units): the confluence fillet. */
export const RIVER_FILLET = 24;
/** The surface sits this far under the terrain at the centerline: deeper than a lake's, so beside a
 *  city the quay road (curbHeight under the plateau) stays above the water. */
export const RIVER_SURFACE_BELOW = 2.5;

/** A piece's verdict (riverPieceRules.ts): 0 = built, else why not. */
export const RIVER_BLOCK_WATER = 1;
export const RIVER_BLOCK_PROHIBITED = 2;
export const RIVER_BLOCK_HIGH = 3;
/** High ground that is genuinely mountainous (the biome relief past RIVER_MAX_RELIEF): never filled. */
export const RIVER_BLOCK_MOUNTAIN = 4;

/** Dressing keeps this far (factor-1 river units) from a river centerline: the channel and its banks. */
export const riverKeepOff = (): number => domainConfig!.river.halfWidth + domainConfig!.river.bank;

/** The widest a river's footprint (+ meander) can reach from its centerline, real units. */
export const riverMaxReach = (): number => riverKeepOff() * RIVER_WIDTH_MAX * RIVER_POND_FACTOR + RIVER_MEANDER_AMP;

/** The widest a river's WET field (riverSample.distance < halfWidth + bank) reaches from a raw
 *  piece, real units: the smooth minimum's dip, the widest width factor, the meander in both axes. */
export const riverWetReach = (): number =>
  (riverKeepOff() + RIVER_FILLET / 4) * RIVER_WIDTH_MAX * RIVER_POND_FACTOR + 2 * RIVER_MEANDER_AMP;
