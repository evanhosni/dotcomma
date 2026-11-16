import type { PondSpec } from "../../../../utils/workers/water/ponds/params";

/** The overworld's KINDS of pond, mounted as <Pond kind={…}/> in its regions and biomes. Three-free: the
 *  server reads them. A radius × (1 + blob amount) is capped at the river field's widest footprint
 *  (rivers/field.ts discWidth). The radii are 1.5× P6's (Nov 2026: too small to read as ponds). */

export const POND: PondSpec = { id: "pond", radius: [68, 120], depth: 1.1, blob: { amount: 0.15, lobes: 3 } };
/** A spring's clear teal and a hot spring's milky turquoise, darkening to ~45% of themselves by `deepDepth`
 *  (both are shallow: a 0.5–0.6 depth bowl is 4–8u deep, so the default 14u would never reach it). */
export const SPRING: PondSpec = { id: "spring", radius: [33, 82], depth: 0.6, blob: { amount: 0.45, lobes: 5 }, shallowColor: "#4fb4a8", deepColor: "#24514c", deepDepth: 6 };
export const HOT_SPRING: PondSpec = { id: "hotSpring", radius: [42, 75], depth: 0.5, blob: { amount: 0.2, lobes: 4 }, shallowColor: "#8fdcd2", deepColor: "#40635e", deepDepth: 6 };
