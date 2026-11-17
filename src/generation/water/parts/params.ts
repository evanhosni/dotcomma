/** Where a body's PARTS stand (./index.ts): THE ZONE RULE, and which bodies mounted a part. Three-free. */

import { domainConfig } from "../../store";
import type { WaterBody, WaterZone, ZonedBody } from "../types";

/**
 * THE ZONE RULE: where in a body of water a part stands, by the water over the ground (`waterDepth`)
 * where the body owns the vertex (VertexResult.waterBody/waterBodyShare/waterBody2) — SUBMERGED from
 * SHALLOWS_DEPTH down, the SHALLOWS above it, and the BANK: the dry ground still in the body's reach (a
 * lake's shore, a river's or a pond's bank). A part picks its zone with its `zone` prop; unset, its class's
 * default (WATER_ZONE_DEFAULTS). SHALLOWS_DEPTH is in real units: the beebles' ankle-deep water.
 */
export const SHALLOWS_DEPTH = 0.9;
export const WATER_ZONE_DEFAULTS = { actor: "shallows", foliage: "submerged", particle: "submerged" } as const satisfies Record<string, WaterZone>;

export const waterZoneOf = (depth: number): WaterZone => (depth >= SHALLOWS_DEPTH ? "submerged" : depth > 0 ? "shallows" : "bank");

/** How much of a vertex's water belongs to any of `slots` (0–1), from its VertexResult body slots. */
export const waterOwnedBy = (slots: readonly number[], body: number, share: number, body2: number): number =>
  (slots.includes(body) ? share : 0) + (body2 >= 0 && slots.includes(body2) ? 1 - share : 0);

/** The share of a vertex owned by the bodies whose part stands in its zone (0–1). */
export const zonedShare = (
  bodies: readonly ZonedBody[],
  vd: { waterBody: number; waterBodyShare: number; waterBody2: number },
  depth: number,
): number => {
  const zone = waterZoneOf(depth);
  let share = 0;
  for (const b of bodies) {
    if (b.zone !== zone) continue;
    if (b.slot === vd.waterBody) share += vd.waterBodyShare;
    else if (b.slot === vd.waterBody2) share += 1 - vd.waterBodyShare;
  }
  return Math.min(1, share);
};

/** Every body of water that mounted a part of this kind, with its slot and the part's resolved params —
 *  what a water part's ONE driver reads to draw every mount of it. */
export const waterBodiesWith = <T>(partKind: string): { slot: number; body: WaterBody; params: T }[] => {
  const out: { slot: number; body: WaterBody; params: T }[] = [];
  domainConfig?.waterBodies.forEach((body, slot) => {
    if (partKind in body.parts) out.push({ slot, body, params: body.parts[partKind] as T });
  });
  return out;
};

/** The biomes whose water these bodies can own (a body owns water only where a biome carries it). */
export const bodyBiomeIds = (slots: readonly number[]): number[] => {
  const ids = new Set<number>();
  for (const region of domainConfig?.regions ?? []) {
    for (const biome of region.biomes) if (biome.waterBodies?.some((s) => slots.includes(s))) ids.add(biome.id);
  }
  return [...ids];
};
