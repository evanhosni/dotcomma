/** THE WATER'S COLOURS (world/water/README.md "Colour"): a mount's colour props as the config holds them,
 *  each body's colours resolved biome → region → <Water>, and the per-vertex blend the terrain worker
 *  writes into the one water program's attributes. Three-free. */

import { domainConfig } from "../computeConfig";
import type { DomainConfig } from "../types";
import { WATER_DEFAULTS } from "./params";
import type { WaterBody, WaterColor, WaterColorProps, WaterColors } from "./types";

/** A mount's colour props as the config holds them (RGB triples; only the ones it names). */
export const readWaterColors = (props: WaterColorProps): Partial<WaterColors> => {
  const rgb = (c: string | WaterColor): WaterColor =>
    typeof c === "string" ? [0, 2, 4].map((i) => parseInt(c.slice(1 + i, 3 + i), 16) / 255) as unknown as WaterColor : c;
  return {
    ...(props.shallowColor === undefined ? {} : { shallowColor: rgb(props.shallowColor) }),
    ...(props.deepColor === undefined ? {} : { deepColor: rgb(props.deepColor) }),
    ...(props.deepDepth === undefined ? {} : { deepDepth: props.deepDepth }),
  };
};

/** A body's own colours: every body's params carry the ones it names. */
const ownColors = (body: WaterBody): Partial<WaterColors> => {
  const own = body.params as Partial<WaterColors> | undefined;
  return {
    ...(own?.shallowColor ? { shallowColor: own.shallowColor } : {}),
    ...(own?.deepColor ? { deepColor: own.deepColor } : {}),
    ...(own?.deepDepth !== undefined ? { deepDepth: own.deepDepth } : {}),
  };
};
/** Each body's water colours in a config, by slot, resolved biome → region → domain: its own, else its
 *  region's body of the same id (a biome's mount of it overrides that one prop by prop), else the <Water>
 *  base's. A pure function of the config (kept per config object): the main thread reads it too, for the
 *  water the camera is in, without initializing the pipeline. */
const colorsByConfig = new WeakMap<DomainConfig, WaterColors[]>();
const slotColorsOf = (config: DomainConfig): WaterColors[] => {
  let slots = colorsByConfig.get(config);
  if (!slots) {
    const base = config.water?.params ?? WATER_DEFAULTS;
    const bodies = config.waterBodies;
    slots = bodies.map((body) => {
      const region = body.biomeId === undefined ? undefined : config.regions.find((r) => r.biomes.some((b) => b.id === body.biomeId));
      const above = region ? bodies.find((b) => b.id === body.id && b.regionId === region.id) : undefined;
      const { shallowColor, deepColor, deepDepth } = { ...base, ...(above ? ownColors(above) : {}), ...ownColors(body) };
      return { shallowColor, deepColor, deepDepth };
    });
    colorsByConfig.set(config, slots);
  }
  return slots;
};
/** The colours of the water in body `slot` (−1: the <Water> base's). */
export const bodyWaterColors = (config: DomainConfig | null, slot: number): WaterColors =>
  (config && slotColorsOf(config)[slot]) ?? config?.water?.params ?? WATER_DEFAULTS;

/** The water's colours at a vertex owned by `body` by `share` and `body2` by the rest (VertexResult's
 *  slots; −1: the <Water> base's), into `shallow` (RGB) and `deep` (RGB + its depth) at `i`: what the terrain
 *  worker writes per vertex, and what the camera's water probe reads (with the committed `config`). */
export const writeWaterColors = (body: number, share: number, body2: number, shallow: Float32Array, deep: Float32Array, i: number, config: DomainConfig | null = domainConfig): void => {
  const a = bodyWaterColors(config, body);
  const b = body2 >= 0 ? bodyWaterColors(config, body2) : a;
  const t = body2 >= 0 ? share : 1;
  for (let c = 0; c < 3; c++) {
    shallow[i * 3 + c] = b.shallowColor[c] + (a.shallowColor[c] - b.shallowColor[c]) * t;
    deep[i * 4 + c] = b.deepColor[c] + (a.deepColor[c] - b.deepColor[c]) * t;
  }
  deep[i * 4 + 3] = b.deepDepth + (a.deepDepth - b.deepDepth) * t;
};
