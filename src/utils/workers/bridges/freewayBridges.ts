/**
 * BRIDGES — every road that enters a river's footprint is carried over it (CLAUDE.md "Inter-city
 * freeways and bridges"). This is the entry: getFreewayBridges (the decks a chunk owns) and
 * getFreewayBridgesNear (every deck reaching into a box, for the ground cut under decks).
 *
 * THE GOAL: every road (inter-city run, city belt, city arterial) that enters a river's footprint
 * is carried on a deck from dry road on one side to dry road on the other, continuous with the
 * road network — merging into the decks of the roads it meets — and never ending in the water.
 * Roads and rivers are both analytic, so decks are found GEOMETRICALLY:
 *  1. RoadPaths (roadPaths.ts): the stretches of every road within BRIDGE_ROAD_MARGIN of a river
 *     footprint, as samples on a canonical lattice, so every chunk samples a road identically.
 *  2. WetItems (wetItems.ts): each maximal run of samples inside a footprint (+ the meander),
 *     extended by the abutment onto the dry road beside it (a LANDED end) — or OPEN where the road
 *     itself ends while wet (a run at a belt corner, a segment arterial at its row, an arterial at
 *     the wall).
 *  3. Joins (wetItems.ts): open ends meeting end to end continue as one chain only if nearly
 *     straight (the straightest pair through a node); an open end beside another deck's middle is
 *     a T onto it; an open end with nothing there drops its chain rather than leaving it in the water.
 *  4. The RULES (rules.ts, deckBuilder.ts): a deck landed at both ends must CROSS a river centerline
 *     bank to bank at ≥ BRIDGE_MIN_CROSSING; no deck follows the shore for long
 *     (BRIDGE_MAX_ALONG_SHORE, longer for the inter-city runs) or turns sharply (corners are rounded,
 *     BRIDGE_MAX_TURN); a T meets its host at ≥ BRIDGE_MIN_T_ANGLE; a chain between two decks drops.
 *     A road that fails them is not decked: in a city it ends at the quay, which runs along the bank.
 *  5. Decks, LAZILY (deckBuilder.ts, finishDeck.ts): only chains whose midpoint lies in the queried
 *     chunk, plus the hosts their T ends take a height from and the decks meeting them (parapet
 *     gaps, lane paint). The terrain asks for every deck reaching into a cell instead
 *     (getFreewayBridgesNear) and cuts the ground under exactly those. A LANDED end ramps into the
 *     road (bridgeRampAt).
 *  6. CROSSINGS OF THEIR OWN (crossings.ts, mouths.ts): a river with city on both banks also gets
 *     straight decks from pavement to pavement (the quays count) — where an arterial crosses it
 *     without a deck, and at least one per FILL_STEP along it — and every FREEWAY MOUTH (any
 *     freeway reaching a river, in a city or between two) a deck: freeway-width, curved onto the
 *     mouth facing it across the river (several mouths facing one merge into a Y), or street-width
 *     onto the pavement across when none faces it.
 * All of it inside a window around the chunk, widened only when a deck depends on a chain at the
 * window's edge (BRIDGE_WINDOWS), so every chunk decides every chain the same way.
 */

import { domainConfig } from "../computeConfig";
import { warp } from "../noise";
import { riverPiecesNear, riverPiecesRaw, riversEnabled, riverWetReach } from "../rivers/riverNetwork";
import { BRIDGE_MAX_DEVIATION, BRIDGE_WET_MERGE, BRIDGE_WET_SAMPLE, deckWidth, warpMax } from "./constants";
import { clearCrossingCaches, CROSSING_MID_REACH, crossingChain, findCrossings, resolveCrossingChain } from "./crossings";
import { deckBuilder } from "./deckBuilder";
import { deckMerges, finishDeck } from "./finishDeck";
import { clearMouthCaches, MOUTH_PAIR_MAX } from "./mouths";
import { collectRoadPaths } from "./roadPaths";
import type { BridgeChain, BridgePlacementParams, BridgeWindow, FreewayBridge, WindowScan } from "./types";
import { joinMergeWalls } from "./wallJoins";
import { findWetItems, linkWetItems } from "./wetItems";

/** Roads and rivers are considered within ±window of the chunk center (warped). A chain with a sample
 *  within BRIDGE_EDGE_GUARD of the window's edge may differ from what a wider window sees: a chunk
 *  whose decks DEPEND on such a chain (a host, a child) retries with the next window, and at the last
 *  one the chain drops. (A single 800 window splits T-junctions across chunks — a host and its child
 *  owned by different chunks each see the other cut off — and one 2200 window costs ~100× per chunk.) */
const BRIDGE_WINDOWS = [900, 1800, 3200];

/** Diagnostics of the last getFreewayBridges call (probes): every dropped chain says why; `window`
 *  is the window the result came from (0 = no river near the chunk). */
export const bridgeDebug = { items: 0, dropped: 0, joins: 0, owned: 0, crossings: 0, window: 0, drops: [] as string[] };

const resetBridgeDebug = (): void => {
  bridgeDebug.items = 0;
  bridgeDebug.dropped = 0;
  bridgeDebug.joins = 0;
  bridgeDebug.owned = 0;
  bridgeDebug.crossings = 0;
  bridgeDebug.drops = [];
};

/** Set while decks are being enumerated: the terrain cut under decks (computeVertexData) needs the
 *  decks, and the decks sample the terrain — the landed ends' road heights never lie under a deck. */
export let enumeratingBridges = 0;

export const whileEnumeratingBridges = <T>(run: () => T): T => {
  enumeratingBridges++;
  try {
    return run();
  } finally {
    enumeratingBridges--;
  }
};

/** Which chains a window query builds: the ones a chunk OWNS (midpoint inside it), or every one
 *  whose deck can reach into a box (the terrain cut under decks). */
type BridgeQuery = { kind: "owned" } | { kind: "overlap"; pad: number };

const runBridgeQuery = (minX: number, minZ: number, maxX: number, maxZ: number, params: BridgePlacementParams, query: BridgeQuery): FreewayBridge[] => {
  bridgeDebug.window = 0;
  resetBridgeDebug();
  if (!domainConfig || !riversEnabled) return [];
  // Exact early out: every point of a deck lies within a wet merge + a sample + the simplification
  // of a wet sample + the deck's half-width, so a box no raw piece comes that close to meets none.
  const pad = query.kind === "overlap" ? query.pad : 0;
  const reach = riverWetReach() + BRIDGE_WET_MERGE + BRIDGE_WET_SAMPLE + BRIDGE_MAX_DEVIATION + warpMax() + deckWidth() / 2 + pad;
  if (riverPiecesRaw(warp((minX + maxX) / 2, (minZ + maxZ) / 2), minX, minZ, maxX, maxZ, reach).length === 0) return [];
  return whileEnumeratingBridges(() => {
    for (let i = 0; i < BRIDGE_WINDOWS.length; i++) {
      const decks = bridgesInWindow(minX, minZ, maxX, maxZ, params, BRIDGE_WINDOWS[i], i === BRIDGE_WINDOWS.length - 1, query);
      if (decks) {
        bridgeDebug.window = BRIDGE_WINDOWS[i];
        return decks;
      }
    }
    return [];
  });
};

/** The decks a chunk owns (midpoint inside it), complete: parapet gaps and lane paint included. */
export function getFreewayBridges(minX: number, minZ: number, maxX: number, maxZ: number, params: BridgePlacementParams): FreewayBridge[] {
  return runBridgeQuery(minX, minZ, maxX, maxZ, params, { kind: "owned" });
}

/** Every deck whose footprint (+ `pad`) reaches into a box — what the terrain cuts the ground under.
 *  Geometry and heights only (no gaps or paint). */
export function getFreewayBridgesNear(minX: number, minZ: number, maxX: number, maxZ: number, params: BridgePlacementParams, pad: number): FreewayBridge[] {
  return runBridgeQuery(minX, minZ, maxX, maxZ, params, { kind: "overlap", pad });
}

/** Thrown inside a strict window when a deck it must build depends on a chain at its edge. */
export const WINDOW_TOO_SMALL = new Error("bridge window too small");

/** The decks a query wants as seen from ±`size` around its box's center, or null when that window
 *  cannot decide them (never for the `last` window: there an undecidable chain drops). */
function bridgesInWindow(minX: number, minZ: number, maxX: number, maxZ: number, params: BridgePlacementParams, size: number, last: boolean, query: BridgeQuery): FreewayBridge[] | null {
  resetBridgeDebug();
  const rv = domainConfig!.river;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const center = warp(cx, cz);
  const win: BridgeWindow = { x0: center.x - size, z0: center.z - size, x1: center.x + size, z1: center.z + size };
  const pieces = riverPiecesNear(win.x0, win.z0, win.x1, win.z1, riverWetReach());
  if (pieces.length === 0) return [];
  const scan: WindowScan = { win, size, cx, cz, center, reach: rv.halfWidth + rv.bank, pieces, built: null };

  const paths = collectRoadPaths(scan);
  const items = findWetItems(paths, scan, params.abutment);
  const crossings = findCrossings(scan, paths);
  bridgeDebug.items = items.length;
  if (items.length === 0 && crossings.length === 0) return [];
  const chains = linkWetItems(items);
  const synths = crossings.map((c) => crossingChain(scan, c));
  // A mouth branch's far end tees into its trunk's deck (always emitted with it, findCrossings).
  const byKey = new Map(synths.map((s) => [s.synth!.key, s]));
  for (const s of synths) {
    const g = s.synth!.geom;
    if (!s.synth!.trunk || !g || g.teeEnd === undefined) continue;
    const trunk = byKey.get(s.synth!.trunk)!;
    const j = g.path[g.teeEnd === 0 ? 0 : g.path.length - 1];
    s.ends[g.teeEnd] = { kind: "tee", host: null, hostChain: trunk, hx: j.x, hz: j.z };
    trunk.children.push(s);
  }
  chains.push(...synths);
  const build = deckBuilder(scan, params, last, chains, synths);

  const out: FreewayBridge[] = [];
  const emitted = new Set<string>();
  const meets = (c: BridgeChain, r: number) => !(c.maxX < minX - r || c.minX > maxX + r || c.maxZ < minZ - r || c.minZ > maxZ + r);
  try {
    if (query.kind === "overlap") {
      const r = deckWidth() / 2 + query.pad;
      // A mouth crossing's box before its geometry is known covers where its deck is MIDPOINTED (the
      // owner's test); its deck reaches up to MOUTH_PAIR_MAX from its mouths, and the chunk under a
      // lone mouth's far end must see the deck to cut the ground there.
      const unresolvedReach = MOUTH_PAIR_MAX * 0.7;
      for (const c of chains) {
        const loose = c.synth?.box && !c.synth.geom && c.path.length === 0 ? unresolvedReach : 0;
        if (!meets(c, r + loose) || (c.synth && (!resolveCrossingChain(c) || !meets(c, r)))) continue;
        const deck = build(c);
        if (!deck) continue;
        // Finished like the owner's (parapet gaps and paint breaks are sections too): the ground is cut
        // under the slab exactly as it is drawn.
        finishDeck(c, chains, build);
        out.push(deck);
      }
      return out;
    }
    for (const c of chains) {
      if (c.synth) {
        // Its midpoint lies within CROSSING_MID_REACH of the crossing point (a mouth deck's within
        // its bounds); the geometry says where.
        const b = c.synth.box;
        if (b ? b[2] < minX || b[0] >= maxX || b[3] < minZ || b[1] >= maxZ : c.synth.x < minX - CROSSING_MID_REACH || c.synth.x >= maxX + CROSSING_MID_REACH || c.synth.z < minZ - CROSSING_MID_REACH || c.synth.z >= maxZ + CROSSING_MID_REACH) continue;
        if (!resolveCrossingChain(c)) continue;
      } else if (c.edge) {
        // A chain at the edge is never one this chunk owns: an owned chain (≤ BRIDGE_MAX_LENGTH)
        // stays ≥ the guard inside the first window.
        continue;
      }
      if (c.midX < minX || c.midX >= maxX || c.midZ < minZ || c.midZ >= maxZ) continue;
      const deck = build(c);
      if (!deck) continue;
      const key = `${deck.x.toFixed(3)},${deck.z.toFixed(3)}`;
      if (emitted.has(key)) continue;
      emitted.add(key);
      finishDeck(c, chains, build);
      out.push(deck);
    }
    // Wall joins read the partners' finished walls (finished here if their owner is another chunk, after
    // every owned deck: finishing order changes no owned deck's gaps).
    const chainOf = new Map<FreewayBridge, BridgeChain>();
    for (const c of chains) if (c.deck) chainOf.set(c.deck, c);
    for (const deck of out) {
      const partners = deckMerges(deck) ?? [];
      for (const p of partners) {
        const pc = chainOf.get(p);
        if (pc) finishDeck(pc, chains, build);
      }
      joinMergeWalls(deck, partners);
    }
  } catch (err) {
    if (err === WINDOW_TOO_SMALL) return null;
    throw err;
  }
  bridgeDebug.owned = out.length;
  bridgeDebug.crossings = synths.filter((c) => c.deck && out.includes(c.deck)).length;
  return out;
}

export const clearBridgeCaches = (): void => {
  clearCrossingCaches();
  clearMouthCaches();
};
