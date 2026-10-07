/**
 * The ground under the decks (computeVertexData step 7): under every deck that exists — and
 * nowhere else — the ground is cut just below its top so nothing rises through it (a cut under
 * every road in a river's footprint left dark pits, and water in them, wherever a road had no
 * deck); where water is drawn the cut stops above it. Off the city the road a deck carries is not
 * painted on the ground under and beside it either, faded in from each landed end, where the deck
 * lies on that very road and a hard stop would alias past its end. A landed CUT end's MOUTH — the
 * road in front of the cut — is asphalt meeting the slab flush.
 */

import { smoothstep } from "../../math/_math";
import { CHUNK_SIZE, LOD1_SEGMENTS } from "../../../world/terrain/lodConfig";
import { domainConfig } from "../computeConfig";
import { computeVertexDataRaw } from "../flattenPads";
import { NO_ROAD_DISTANCE, cityCurbDip } from "../roads/cityRoadField";
import { BRIDGE_CUT_FEATHER, BRIDGE_CUT_FLUSH, DEFAULT_BRIDGE_PLACEMENT } from "./constants";
import { bridgeRampSpan } from "./deckGeometry";
import { bridgeApproach, bridgeApproachAt, bridgeMouth, bridgeMouthAt, bridgeMouthFieldAt } from "./deckMouth";
import { bridgeDrawn, bridgeDrawnAt, bridgeSideIn, bridgeTriangleCap } from "./drawnSlab";
import { getFreewayBridgesNear } from "./freewayBridges";
import type { FreewayBridge } from "./types";

/** The cut never lowers the ground where water is drawn to less than this above the surface. */
const DECK_CUT_WATER_CLEAR = 0.3;
/** A cut end's fill fades out over this past the margin inward of its cut line. */
const DECK_FILL_FADE = 2;
/** Under a deck the road's paint gives way to the ground over this far past a landed end's ramp. */
const DECK_PAINT_END_FADE = 8;
/** A landed cut end's mouth paints as this much of the road field (street units): asphalt, clear of
 *  the gutter line and the curb (the bands: asphalt 0–7, curb 7–8, sidewalk 8–12)… */
const DECK_MOUTH_FIELD = 4.5;
/** In front of a landed cut end the road is held at the cut's height as far as a terrain triangle reaching
 *  the slab can have a vertex (the drawn slab's flush margin), then eases back to its own over this (eased
 *  from the cut itself, the two would disagree at the margin: a step of units on a steep road). */
const DECK_MOUTH_EASE = 16;
/** A landing's approach fades back into the road's own over this past the mouth's ease. */
const DECK_APPROACH_FADE = 16;
/** The smooth minimum joining a mouth's field to the road's (street units): the corner fillet's size. */
const DECK_MOUTH_FILLET = 2;
/** A freeway's lane paint ends this far (real units) short of the river end of its road (step 7b)… */
export const LANE_END_CLEAR = 24;
/** …unless a deck's landed end lies within this of the vertex (the deck carries the road on). */
const DECK_END_REACH = 40;
/** Inward of a landed end the bank's rim takes the road back up over this (approachRimLift). */
const DECK_RIM_LIFT_IN = 8;
/** How far past a deck a landing's approach reaches (bridgeApproachAt): in front, LOD2's cut margin (25)
 *  + DECK_MOUTH_EASE + DECK_APPROACH_FADE; beside, the deck's half-width + 34. A cell lists every deck
 *  within it, or the approach would stop at a cell's edge. */
const DECK_APPROACH_REACH = 60;

const DECK_CELL = 256;
export const NO_DECKS: FreewayBridge[] = [];
const deckCells = new Map<number, FreewayBridge[]>();
const DECK_CELLS_MAX = 4096;
export const clearDeckCells = (): void => deckCells.clear();

/** Every deck whose cut (footprint + feather) reaches into the vertex's 256u cell, per cell. */
export const decksAround = (x: number, z: number): FreewayBridge[] => {
  const ix = Math.floor(x / DECK_CELL);
  const iz = Math.floor(z / DECK_CELL);
  const key = ix * 2097152 + iz;
  let decks = deckCells.get(key);
  if (!decks) {
    if (deckCells.size >= DECK_CELLS_MAX) {
      let drop = deckCells.size >> 1;
      for (const k of deckCells.keys()) {
        if (drop-- <= 0) break;
        deckCells.delete(k);
      }
    }
    const minX = ix * DECK_CELL;
    const minZ = iz * DECK_CELL;
    decks = getFreewayBridgesNear(minX, minZ, minX + DECK_CELL, minZ + DECK_CELL, DEFAULT_BRIDGE_PLACEMENT, Math.max(BRIDGE_CUT_FEATHER, DECK_END_REACH, DECK_APPROACH_REACH));
    if (decks.length === 0) decks = NO_DECKS;
    deckCells.set(key, decks);
  }
  return decks;
};

export const deckEndNear = (decks: FreewayBridge[], x: number, z: number): boolean => {
  for (let i = 0; i < decks.length; i++) {
    const b = decks[i];
    const p = b.path;
    if (b.landings?.[0] && Math.hypot(p[0].x - x, p[0].z - z) < DECK_END_REACH) return true;
    if (b.landings?.[1] && Math.hypot(p[p.length - 1].x - x, p[p.length - 1].z - z) < DECK_END_REACH) return true;
  }
  return false;
};

/** How far beside a deck's drawn slab the ground is cut to its top (bridgeDrawnAt): as far as a
 *  terrain triangle spanning the slab can have a vertex — the vertex spacing's diagonal, and a little.
 *  LOD1's by default (the colliders, the server's heightfields, the player's backstop); the terrain
 *  worker sets its chunk's own (setDeckCutSpacing) — a LOD2 triangle is 17.5u across. */
const LOD1_SPACING = CHUNK_SIZE / LOD1_SEGMENTS;
const deckCutMarginFor = (spacing: number): number => spacing * Math.SQRT2 + 0.5;
let deckCutSpacing = LOD1_SPACING;
let deckCutMargin = deckCutMarginFor(LOD1_SPACING);
export const setDeckCutSpacing = (spacing: number): void => {
  deckCutSpacing = Math.max(LOD1_SPACING, spacing);
  deckCutMargin = deckCutMarginFor(deckCutSpacing);
};

/** The ground's own road field at a world point, no deck (a mouth's profile, bridgeMouthFieldAt). */
const groundRoadField = (x: number, z: number): number => computeVertexDataRaw(x, z).distanceToRoadCenter;

/** The vertex fields step 7 reads and rewrites (one shared object: no per-vertex allocation). */
export const deckGround = { height: 0, roadField: 0, freewayField: 0, waterHeight: NaN, underDeck: 0, approachDelta: 0, approachRimLift: 0 };

/** Step 7 over the decks reaching the vertex's cell, on `deckGround`. */
export const cutGroundUnderDecks = (decks: FreewayBridge[], x: number, z: number, inCity: boolean, distanceToRiver: number): void => {
  const g = deckGround;
  const river = domainConfig!.river;
  // First, a landed end's APPROACH is the road at its own grade, flat across the deck's width: the river's
  // bank gives way to it there (VertexResult.approachHeight), not it to the bank.
  if (g.approachDelta !== 0 || g.approachRimLift !== 0) {
    let approach = 0;
    let behind = 0;
    for (let i = 0; i < decks.length; i++) {
      bridgeApproachAt(decks[i], x, z, deckCutMargin, deckCutMargin + DECK_MOUTH_EASE, DECK_APPROACH_FADE);
      if (bridgeApproach.weight <= approach) continue;
      approach = bridgeApproach.weight;
      behind = smoothstep(0, DECK_RIM_LIFT_IN, -bridgeApproach.depth);
    }
    // Never into the channel: the deck carries the road over it. (The bank out to the water band's edge
    // is held above the water already: a gate past it cut the road down at an oblique cut's corner.) A
    // road under the river's rim is held up to it inward of the end, under the deck (no water over it).
    const delta = g.approachDelta + g.approachRimLift * behind;
    g.height += delta * approach * smoothstep(river.halfWidth, river.halfWidth + river.bank * 0.5, distanceToRiver);
  }
  // 7a: in front of a landed CUT end the road meets the slab flush: its ground lies at the cut's own
  // height at the cut out to the flush margin, easing back to the road's over DECK_MOUTH_EASE (its paint: 7e).
  let mouth = 0;
  let mouthDepth = 0;
  let mouthTop = 0;
  for (let i = 0; i < decks.length; i++) {
    bridgeMouthAt(decks[i], x, z, deckCutMargin + DECK_MOUTH_EASE);
    if (bridgeMouth.weight <= mouth) continue;
    mouth = bridgeMouth.weight;
    mouthDepth = bridgeMouth.depth;
    mouthTop = bridgeMouth.top;
  }
  // The curb's own rise comes off only where the slab holds the ground; elsewhere it follows the field
  // the mouth paints (7e, below). Taken off across the whole mouth, it came back in a 0.26u step where
  // the mouth's reach ended, which the fake directional shading drew as a dark streak on the road
  // (screenshot 102).
  const cfg = domainConfig!.cityConfig;
  let hold = 0;
  if (mouth > 0) {
    const asphalt = g.height - cfg.curbHeight + cityCurbDip(g.roadField);
    hold = mouth * (1 - smoothstep(deckCutMargin, deckCutMargin + DECK_MOUTH_EASE, mouthDepth));
    g.height = asphalt + (mouthTop + BRIDGE_CUT_FLUSH - asphalt) * hold + (g.height - asphalt) * (1 - hold);
  }
  let underDeck = 0;
  // The fill under a cut end's seam (its height and weight), and every cap the vertex is under (the fill
  // never rises past one).
  let fillTo = -Infinity;
  let fillWeight = 0;
  let capAll = Infinity;
  for (let i = 0; i < decks.length; i++) {
    const b = decks[i];
    bridgeDrawnAt(b, x, z, deckCutMargin);
    const cut = bridgeDrawn.weight;
    if (cut <= 0) continue;
    underDeck = Math.max(underDeck, cut);
    // Under the DRAWN slab — its own quads, ramps, cross-falls, landed cuts and T cuts included — and
    // beside it as far as a terrain triangle reaching the slab can have a vertex (or the ground rises
    // through the deck between LOD vertices), exact for the terrain's own triangles
    // (bridgeTriangleCap; clobbers bridgeDrawn). In front of a landed cut end the road is flush with the
    // cut; over a ramp's first units the slab dives under the road on purpose (no ledge).
    const s = bridgeDrawn.t * b.length;
    // Just inward of a landed cut end the ground is FILLED up to the slab too (the channel excepted), or
    // the triangles across the seam run from the flush road down to a bank or bed far under the slab
    // and the road dips in front of the cut — but not near the slab's SIDE edges, where the triangles
    // reach the ground beside the deck instead (at an oblique cut's acute corner the fill stood as a wall
    // of ground up to the deck top beside it, its foot stepped into the terrain's lattice): none within the
    // margin of a side, all from twice that in. Faded past the cut's margin too, so it never steps.
    const cutIn = bridgeDrawn.cutIn;
    const fillable = cut >= 1 && Number.isNaN(bridgeDrawn.flush) && cutIn < deckCutMargin + DECK_FILL_FADE && distanceToRiver >= river.halfWidth;
    let target = cut >= 1 ? bridgeTriangleCap(b, x, z, deckCutSpacing, deckCutMargin) : bridgeDrawn.ref;
    if (fillable) {
      const w = (1 - smoothstep(deckCutMargin, deckCutMargin + DECK_FILL_FADE, cutIn)) * smoothstep(deckCutMargin, 2 * deckCutMargin, bridgeSideIn(b, x, z));
      if (w > 0 && target > fillTo) {
        fillTo = target;
        fillWeight = w;
      }
    }
    // Above any water drawn here — a lake's too, or a deck at a river mouth cuts its bank under the
    // lake's level and the lake shows through beside it — unless the slab itself is lower than that (a
    // landed end beside a bank standing over the road it lands on): then the water is not drawn at this
    // vertex and the ground goes under the slab all the same (else the bank rises through the deck).
    if (!Number.isNaN(g.waterHeight)) {
      if (cut >= 1 && target < g.waterHeight + DECK_CUT_WATER_CLEAR) g.waterHeight = NaN;
      else target = Math.max(target, g.waterHeight + DECK_CUT_WATER_CLEAR);
    }
    if (cut >= 1) capAll = Math.min(capAll, target);
    if (g.height > target) g.height += (target - g.height) * cut;
    if (!inCity) {
      // The road stays painted under a landed end's whole pad and ramp, where the slab lies on it.
      const from0 = b.landings?.[0] ? s - (b.trimStart ?? 0) : Infinity;
      const from1 = b.landings?.[1] ? b.length - (b.trimEnd ?? 0) - s : Infinity;
      const span0 = bridgeRampSpan(b, 0);
      const span1 = bridgeRampSpan(b, 1);
      // (Never in a cut end's mouth: that is the road meeting the slab.)
      const paintOff = cut * (1 - mouth) * Math.min(smoothstep(span0, span0 + DECK_PAINT_END_FADE, from0), smoothstep(span1, span1 + DECK_PAINT_END_FADE, from1));
      if (paintOff > 0) {
        g.roadField = Math.max(g.roadField, (domainConfig!.cityConfig.roadWidth + 6) * paintOff);
        g.freewayField = NO_ROAD_DISTANCE;
      }
    }
  }
  if (g.height < fillTo) g.height += (Math.min(fillTo, capAll) - g.height) * fillWeight;
  g.underDeck = underDeck;
  // 7e: between a landed CUT end and its road's asphalt the ground paints as asphalt — the curb and
  // sidewalk the road ran across the deck's mouth, and any sand the cut's straight line left against a
  // curving pavement edge — and nowhere else (bridgeMouthFieldAt). Joined to the road's own field by a
  // smooth minimum, so the curb rounds the corner where the two meet instead of pointing into it.
  let mouthField = Infinity;
  for (let i = 0; i < decks.length; i++) mouthField = Math.min(mouthField, bridgeMouthFieldAt(decks[i], x, z, deckCutMargin, DECK_MOUTH_FIELD, groundRoadField));
  if (mouthField < g.roadField + DECK_MOUTH_FILLET) {
    const h = Math.max(0, DECK_MOUTH_FILLET - Math.abs(mouthField - g.roadField)) / DECK_MOUTH_FILLET;
    const painted = Math.min(g.roadField, mouthField) - (h * h * DECK_MOUTH_FILLET) / 4;
    // (Not under the slab: the ground there is the cut's, and the slab's corners stand on it.)
    g.height -= (cityCurbDip(painted) - cityCurbDip(g.roadField)) * (1 - hold) * (1 - underDeck);
    g.roadField = painted;
  }
};
