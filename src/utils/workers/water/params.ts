/** THE WATER BASE's kinds, defaults and lookups, from the LIVE config (world/water/README.md): the base
 *  itself (<Water>) and its parts, the kinds of its BODIES, which body a biome carries, and <Quays/>. Each
 *  body's own params live in its folder (lakes/, rivers/, ponds/ `params.ts`); the channel's in channel/,
 *  the parts' zone rule in parts/, the colours in material.ts. Three-free. */

import { biomeById } from "../biomeFlags";
import { domainConfig } from "../computeConfig";
import type { RectXZ } from "../../math/types";
import type { WaterBase, WaterParams } from "./types";

/** <Water>: the base of every body, under the domain. */
export const WATER = "water";
export const WATER_DEFAULTS: WaterParams = { fallGrade: 0.25, shallowColor: [0.22, 0.62, 0.62], deepColor: [0.12, 0.2, 0.28], deepDepth: 14 };

/** The BODIES of water: the declarations a part (seaweed, bubbles, an <Actor>) may be mounted in. A new
 *  body is its declaration (world/components/Water.tsx `declareWaterBody`) plus its kind here. */
export const LAKE = "lake";
export const RIVERS = "rivers";
/** Several kinds of pond share a biome, so a <Pond> is never one of a biome's `features`. */
export const POND_KIND = "pond";
export const WATER_BODY_KINDS = [LAKE, RIVERS, POND_KIND] as const;

/** What a body KIND tells the base about itself, registered by its own module so the base never names a
 *  body: where its water can lie in a world box (`reachIn`, by its DomainConfig.waterBodies slot; unset:
 *  anywhere in it — what narrows its parts' scatter, parts/). */
interface WaterBodyKind {
  reachIn?: (slot: number, area: RectXZ) => RectXZ[];
}
const bodyKinds = new Map<string, WaterBodyKind>();
/** Called once by a body's own module at load (this module is a leaf of the pipeline's import cycle, so it
 *  is always evaluated first). */
export const registerWaterBodyKind = (kind: string, hooks: WaterBodyKind): void => {
  bodyKinds.set(kind, hooks);
};
export const waterBodyKind = (kind: string): WaterBodyKind | undefined => bodyKinds.get(kind);

/** <Quays/>: a biome that keeps its own river banks (world/components/Quays.tsx). */
export const QUAYS = "quays";
export const keepsOwnBanks = (biome: { features?: Readonly<Record<string, unknown>> }): boolean => !!biome.features?.[QUAYS];

/** The <Water> base the domain mounts (null: none — no water anywhere, home and 404). */
const waterBase = (): WaterBase | null => domainConfig?.water ?? null;
/** The resolved params of a part mounted in the base (<WaterfallSplashes/> …), or null where unmounted. */
export const waterBasePart = <T>(kind: string): T | null => (waterBase()?.parts[kind] as T | undefined) ?? null;
/** What a FALL is to every part of the water. */
export const fallGrade = (): number => waterBase()?.params.fallGrade ?? WATER_DEFAULTS.fallGrade;
const NO_DEFAULTS: Readonly<Record<string, unknown>> = {};
/** The domain-wide defaults the <Water> base sets for a body kind's props (<Water defaults>). */
export const waterBodyDefaults = (kind: string): Readonly<Record<string, unknown>> => waterBase()?.params.defaults?.[kind] ?? NO_DEFAULTS;

/** The slot of the body `id` (a body's path segment: "lake", "rivers", "pond:pond") a biome carries — its
 *  own mount, else its region's (−1: none). */
export const bodyOf = (biomeId: number, id: string): number => {
  for (const slot of biomeById(biomeId)?.waterBodies ?? []) if (domainConfig?.waterBodies[slot].id === id) return slot;
  return -1;
};
