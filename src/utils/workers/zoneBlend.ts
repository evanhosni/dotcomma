/**
 * ZONES and the ONE wall pass behind every cross-fade (CLAUDE.md "Blending").
 *
 * A wall between zones a|b opens a transition window: I_a(s) = smoothstep(-h_b, +h_a, s)
 * with s the signed distance into a. Each side contributes its own half on its own
 * side, and I_a + I_b ≡ 1 along the wall, so a clean edge needs no normalization;
 * junctions do (three zones each ~0.5 → renormalized to a third). The vertex's own
 * zone takes the MIN over its walls, foreign zones the MAX over theirs — both
 * continuous, which is what keeps the picture free of per-triangle steps.
 *
 * Heights use each zone's heightHalf (asymmetric: a crisp city keeps its plateau to
 * the wall and the soft neighbor ramps). The material uses the SMALLER side's feather
 * (materialHalf) so a crisp biome never smears into a soft one, and exports a scaled
 * signed distance per biome slot instead of a weight: the shader applies the
 * smoothstep per PIXEL, so a 1–3u feather survives 17.5u quads without aliasing.
 */

import type { DomainConfig, SerializedRegion, Wall, Zone } from "./types";

/** Saturates the shader's smoothstep either way; small enough to stay exact in float32. */
export const BIOME_SDF_FAR = 1e4;

/** A biome whose feather is narrower than a terrain quad never shows the region base at its edge. */
const CRISP_HALF = 2;

/** Zones whose weight is worth evaluating; below this the height contribution is invisible. */
export const ZONE_WEIGHT_EPS = 1e-4;

/** GLSL smoothstep(0, 1, t) on a raw ratio. */
export const sstep01 = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
};

/** Half-widths are floored at 0.5u: a zero window would make a wall's indicators sum to 0. */
export const resolveHalf = (...widths: (number | undefined)[]): number => {
  for (const w of widths) if (w !== undefined) return Math.max(0.5, w / 2);
  return 0.5;
};

// ── Zones and biome slots (interned per init) ─────────────────────────────

export let zones: Zone[] = [];
/** Zones by "region/biome". */
export const zoneByKey = new Map<string, Zone>();
/** A region's zones in its biome order: what a biome roll indexes (no key string per lookup). */
export const zonesByRegion = new Map<SerializedRegion, Zone[]>();
let biomeSlotIds: number[] = [];
let biomeSlotBlendHalves: number[] = [];
/** Zones grouped by ascending heightHalf: the crispest tier claims its share of the
 *  height first, softer tiers split only what is left. */
let zoneTiers: Zone[][] = [];

/** Unique biome ids in region → biome order: the shader's slot order
 *  (world/terrain/material.ts derives the same list from the committed Region[]). */
export const biomeSlotsOf = (config: DomainConfig): number[] => {
  const ids: number[] = [];
  for (const r of config.regions) for (const b of r.biomes) if (!ids.includes(b.id)) ids.push(b.id);
  return ids;
};
export const getBiomeSlots = (): number[] => biomeSlotIds;

/** Per biome slot, the index (config order) of the FIRST region that mounts it — the
 *  region whose base material the shader fades that biome into. */
export const biomeSlotRegionsOf = (config: DomainConfig): number[] => {
  const slots = biomeSlotsOf(config);
  return slots.map((id) => config.regions.findIndex((r) => r.biomes.some((b) => b.id === id)));
};

/** Per biome slot, HALF its material feather — the smallest over the zones that biome
 *  appears in — the crispness order the shader and the foliage combine weights in. */
export const biomeSlotBlendHalvesOf = (config: DomainConfig): number[] => {
  const slots = biomeSlotsOf(config);
  const halves = slots.map(() => Infinity);
  for (const r of config.regions)
    for (const b of r.biomes) {
      const i = slots.indexOf(b.id);
      halves[i] = Math.min(halves[i], resolveHalf(b.blendWidth, r.blendWidth, config.defaultBlendWidth));
    }
  return halves;
};

// ── The wall pass's scratch (workers are single-threaded), sized per init ──

export let zoneWeights = new Float64Array(0);
export let zoneFinal = new Float64Array(0);
/** Unscaled distance to the nearest wall of each zone (own zone included). */
export let zoneMinDist = new Float64Array(0);
export let biomeSdf = new Float64Array(0);
export let biomePresence = new Float64Array(0);
/** The buffers computeVertexData RETURNS. Distinct from the scratch because the flatten-pad
 *  step recurses into computeVertexData for pad candidates AFTER the outer vertex's pass,
 *  and returning the scratch shipped a candidate's distances to the shader (jagged wrong-
 *  texture patches and black slivers wherever a flatten tile was built mid-chunk). */
export let biomeSdfResult = new Float64Array(0);
export let biomePresenceResult = new Float64Array(0);
/** The own zone's nearest wall in the last wall pass: its distance, and a pseudo-arc coordinate
 *  along it (the belt freeway's dash phase — jumps at wall joints, where the shader's fwidth guard
 *  drops the paint). */
export let ownWallDistance = Infinity;
export let ownWallAlong = 0;

/** Interns the config's zones and sizes the wall-pass scratch. */
export const initZones = (config: DomainConfig): void => {
  zones = [];
  zoneByKey.clear();
  zonesByRegion.clear();
  biomeSlotIds = biomeSlotsOf(config);
  for (let ri = 0; ri < config.regions.length; ri++) {
    const region = config.regions[ri];
    for (const biome of region.biomes) {
      const blendHalf = resolveHalf(biome.blendWidth, region.blendWidth, config.defaultBlendWidth);
      // Level by level: a level that sets only blendWidth means it for heights too
      // (the city's 2u), and it beats every default above it.
      const heightHalf = resolveHalf(
        biome.heightBlendWidth,
        biome.blendWidth,
        region.heightBlendWidth,
        region.blendWidth,
        config.defaultHeightBlendWidth,
        config.defaultBlendWidth,
      );
      const zone: Zone = {
        index: zones.length,
        region,
        regionIndex: ri,
        biome,
        slot: biomeSlotIds.indexOf(biome.id),
        blendHalf,
        heightHalf,
        presenceWidth: blendHalf * 2,
        heightPresenceWidth: heightHalf * 2,
        crisp: heightHalf <= CRISP_HALF,
        baseNoise: region.baseNoise ?? config.baseNoiseParams,
      };
      zones.push(zone);
      zoneByKey.set(`${region.id}/${biome.id}`, zone);
    }
  }
  for (const region of config.regions) zonesByRegion.set(region, region.biomes.map((b) => zoneByKey.get(`${region.id}/${b.id}`)!));
  zoneWeights = new Float64Array(zones.length);
  zoneFinal = new Float64Array(zones.length);
  zoneMinDist = new Float64Array(zones.length);
  biomeSdf = new Float64Array(biomeSlotIds.length);
  biomeSdfResult = new Float64Array(biomeSlotIds.length);
  biomePresence = new Float64Array(biomeSlotIds.length);
  biomePresenceResult = new Float64Array(biomeSlotIds.length);
  biomeSlotBlendHalves = biomeSlotBlendHalvesOf(config);
  const byHalf = new Map<number, Zone[]>();
  for (const z of zones) {
    const tier = byHalf.get(z.heightHalf);
    if (tier) tier.push(z);
    else byHalf.set(z.heightHalf, [z]);
  }
  zoneTiers = Array.from(byHalf.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, tier]) => tier);
};

// ── Combining indicators ──────────────────────────────────────────────────

/** Combines raw indicators tier by tier into `out` (sums to 1). Not additive normalization:
 *  beside a city|dust wall a nearby grass wall would get a third of the height on the dust
 *  side and none on the city side — a sawtooth cliff along the edge.
 *  With crispness precedence the city's indicator (1 at its wall, on BOTH sides) leaves
 *  the soft zones nothing there, so the two sides agree. */
export const combineZoneWeights = (indicators: Float64Array, out: Float64Array): void => {
  out.fill(0);
  let remaining = 1;
  let total = 0;
  for (const tier of zoneTiers) {
    let s = 0;
    for (const z of tier) s += indicators[z.index];
    if (s <= 0) continue;
    const scale = remaining * (s >= 1 ? 1 / s : 1);
    for (const z of tier) {
      out[z.index] = indicators[z.index] * scale;
      total += out[z.index];
    }
    remaining *= Math.max(0, 1 - s);
    if (remaining <= 0) break;
  }
  if (total > 0 && Math.abs(total - 1) > 1e-9) for (let i = 0; i < out.length; i++) out[i] /= total;
};

/** The SAME precedence for the material weights, from a vertex's biomeSdf and each slot's
 *  blend half (ascending = crisper first). The terrain shader is generated to mirror this
 *  (combineBiomeMaterials); foliage thins by it. Sums to 1. */
export const combineSlotWeights = (sdf: ArrayLike<number>, slotHalves: readonly number[], out: number[] = []): number[] => {
  const order = slotHalves.map((_, i) => i).sort((a, b) => slotHalves[a] - slotHalves[b]);
  for (let i = 0; i < slotHalves.length; i++) out[i] = 0;
  let remaining = 1;
  let total = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && slotHalves[order[j]] === slotHalves[order[i]]) j++;
    let s = 0;
    for (let k = i; k < j; k++) s += sstep01((sdf[order[k]] + 1) / 2);
    if (s > 0) {
      const scale = remaining * (s >= 1 ? 1 / s : 1);
      for (let k = i; k < j; k++) {
        out[order[k]] = sstep01((sdf[order[k]] + 1) / 2) * scale;
        total += out[order[k]];
      }
      remaining *= Math.max(0, 1 - s);
    }
    if (remaining <= 0) break;
    i = j;
  }
  if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
};

const biomeWeightScratch: number[] = [];
/** The terrain shader's weight of `biomeIds` at a vertex (from its biomeSdf) —
 *  what foliage thins by, so blades fade with the texture instead of stopping on the cell line. */
export const biomeWeightOf = (sdf: ArrayLike<number>, biomeIds: readonly number[]): number => {
  const w = combineSlotWeights(sdf, biomeSlotBlendHalves, biomeWeightScratch);
  let want = 0;
  for (let s = 0; s < w.length; s++) if (biomeIds.includes(biomeSlotIds[s])) want += w[s];
  return want;
};

// ── The wall pass ─────────────────────────────────────────────────────────

/** Fills zoneWeights (height indicators, unnormalized), zoneMinDist, biomeSdf and
 *  biomePresence for (px, pz) in zone `own`; sets ownWallDistance/ownWallAlong. */
export const accumulateWallFields = (px: number, pz: number, walls: Wall[], own: Zone): void => {
  zoneWeights.fill(0);
  zoneWeights[own.index] = 1;
  zoneMinDist.fill(Infinity);
  biomeSdf.fill(-BIOME_SDF_FAR);
  biomeSdf[own.slot] = BIOME_SDF_FAR;
  ownWallDistance = Infinity;
  ownWallAlong = 0;
  const ownBiome = own.biome.id;

  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const dx = w.ex - w.sx;
    const dz = w.ez - w.sz;
    const lenSq = dx * dx + dz * dz;
    let t = lenSq > 0 ? ((px - w.sx) * dx + (pz - w.sz) * dz) / lenSq : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = w.sx + t * dx;
    const cz = w.sz + t * dz;
    const ddx = px - cx,
      ddz = pz - cz;
    const d = Math.sqrt(ddx * ddx + ddz * ddz);
    const a = w.a;
    const b = w.b;

    if (a === own || b === own) {
      if (d < ownWallDistance) {
        ownWallDistance = d;
        ownWallAlong = t * Math.sqrt(lenSq) + w.sx + w.sz;
      }
    }
    if (d < zoneMinDist[a.index]) zoneMinDist[a.index] = d;
    if (d < zoneMinDist[b.index]) zoneMinDist[b.index] = d;

    if (a === b) continue; // a non-joinable biome's internal wall: boundary distance only

    // Height indicators (see the header).
    const span = a.heightHalf + b.heightHalf;
    if (a === own) {
      const ia = sstep01((d + b.heightHalf) / span);
      if (ia < zoneWeights[a.index]) zoneWeights[a.index] = ia;
      const ib = sstep01((a.heightHalf - d) / span);
      if (ib > zoneWeights[b.index]) zoneWeights[b.index] = ib;
    } else if (b === own) {
      const ib = sstep01((d + a.heightHalf) / span);
      if (ib < zoneWeights[b.index]) zoneWeights[b.index] = ib;
      const ia = sstep01((b.heightHalf - d) / span);
      if (ia > zoneWeights[a.index]) zoneWeights[a.index] = ia;
    } else {
      // Outside both: each side's indicator is what a vertex ON THE OTHER SIDE of this
      // wall would compute — a function of the wall alone, never of the vertex's own
      // zone. (With the own zone's half-width here the field would change value
      // across a THIRD zone's wall — a cliff at every junction.)
      const ia = sstep01((b.heightHalf - d) / span);
      if (ia > zoneWeights[a.index]) zoneWeights[a.index] = ia;
      const ib = sstep01((a.heightHalf - d) / span);
      if (ib > zoneWeights[b.index]) zoneWeights[b.index] = ib;
    }

    // Material signed distance per biome slot — keyed by biome ID, not zone: the same
    // biome in another region is the same material.
    if (w.materialHalf > 0) {
      const s = d / w.materialHalf;
      if (a.biome.id === ownBiome) {
        if (s < biomeSdf[a.slot]) biomeSdf[a.slot] = s;
        if (-s > biomeSdf[b.slot]) biomeSdf[b.slot] = -s;
      } else if (b.biome.id === ownBiome) {
        if (s < biomeSdf[b.slot]) biomeSdf[b.slot] = s;
        if (-s > biomeSdf[a.slot]) biomeSdf[a.slot] = -s;
      } else {
        if (-s > biomeSdf[a.slot]) biomeSdf[a.slot] = -s;
        if (-s > biomeSdf[b.slot]) biomeSdf[b.slot] = -s;
      }
    }
  }

  // Presence: how far inside its own boundary each biome is, in its own blend widths —
  // positive for the vertex's biome, negative (→ 0 in the shader) for every other.
  biomePresence.fill(-BIOME_SDF_FAR);
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    const d = zoneMinDist[i];
    if (d === Infinity) continue;
    const v = (z.biome.id === ownBiome ? d : -d) / z.presenceWidth;
    if (v > biomePresence[z.slot]) biomePresence[z.slot] = v;
  }
  if (biomePresence[own.slot] === -BIOME_SDF_FAR) biomePresence[own.slot] = BIOME_SDF_FAR;
};
