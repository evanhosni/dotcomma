/**
 * THE CHANNEL every river and pond is carved by (computeVertexData step 4, ./index.ts): FORCED, not
 * min'ed — it cuts high ground and raises low ground alike. Depth·√factor under the surface at the
 * centerline, a parabola up to a RIM SHORE_RISE above the surface at the half-width; ground lower than the
 * rim is held at it across the whole water band (so no dry vertex outside the channel ever shows water
 * above it) before it blends back into the terrain by the bank's outer edge, and higher ground blends down
 * from the half-width. Past the band every channel's WALLS cut the ground back to a slope. Distances are
 * factor-1 units. Three-free.
 *
 * What the bodies say about it — a channel's depth and walls, the <Banks/> mounted in it — is handed in by
 * the composition (../index.ts), or read off the body that owns a disc; the relief is blended across
 * biomes by the vertex's zone weights, so nothing steps at a biome wall. No body is named here.
 */

import { smoothMin, smoothstep } from "../../../math";
import { domainConfig } from "../../computeConfig";
import { terrainNoise } from "../../noise";
import type { BiomeNoiseConfig, RiverParams, TerrainNoiseParams } from "../../types";
import { ZONE_WEIGHT_EPS, zoneFinal, zones } from "../../zoneBlend";
import { SHORE_RISE } from "../constants";
import { BANKS } from "./params";
import type { BankRelief, BankReliefParams, WallShape } from "../types";

/** Water is drawn out to here (factor-1 units): past the waterline, so the shore triangles are level. */
export const riverWaterBand = (river: RiverParams): number => river.halfWidth + river.bank * 0.5;

/** A biome's bank relief is whole from this much of its zone weight: by the plain weight its banks read
 *  flat over most of where rivers reach it (its feather spans them). */
const BANK_RELIEF_FULL_WEIGHT = 0.25;
/** Every wall rounds over this where it meets the slope above (real units). */
const WALL_ROUND = 24;

export const NO_BANKS: BankRelief = { amounts: new Float64Array(0), any: false };

const layerSum = (layers: TerrainNoiseParams[], x: number, z: number): number => {
  let n = 0;
  for (const layer of layers) n += terrainNoise(layer, x, z);
  return n;
};

/** The domain's <Banks/> by DROP GATE (the props bankLift reads): every distinct gate once, and per body
 *  slot its <Banks/> and the index of its gate (−1: smooth banks). Built once per init. */
let gates: BankReliefParams[] | null = null;
let banksOfSlot: (BankReliefParams | null)[] = [];
let gateOfSlot: Int32Array = new Int32Array(0);
const sameGate = (a: BankReliefParams, b: BankReliefParams): boolean =>
  a === b || (a.dropStart === b.dropStart && a.dropFull === b.dropFull && a.dropScale === b.dropScale && a.dropCap === b.dropCap);
const indexBanks = (): BankReliefParams[] => {
  const found: BankReliefParams[] = [];
  const bodies = domainConfig!.waterBodies;
  banksOfSlot = bodies.map((b) => (b.parts[BANKS] as BankReliefParams | undefined) ?? null);
  gateOfSlot = new Int32Array(bodies.length).fill(-1);
  banksOfSlot.forEach((banks, slot) => {
    if (!banks) return;
    let g = found.findIndex((f) => sameGate(f, banks));
    if (g < 0) g = found.push(banks) - 1;
    gateOfSlot[slot] = g;
  });
  relief = { amounts: new Float64Array(found.length), any: true };
  runRelief = new Float64Array(found.length);
  layersOfNoise.clear();
  return found;
};
const bankGates = (): BankReliefParams[] => gates ?? (gates = indexBanks());
export const clearChannel = (): void => {
  gates = null;
};

/** A biome's relief as the layers a levee takes: its detail layers, or its height noise alone. */
const layersOfNoise = new Map<BiomeNoiseConfig, TerrainNoiseParams[]>();
const noiseLayersOf = (noise: BiomeNoiseConfig): TerrainNoiseParams[] => {
  let layers = layersOfNoise.get(noise);
  if (!layers) layersOfNoise.set(noise, (layers = noise.detail ?? [noise.params]));
  return layers;
};

/** The relief bankReliefAt last wrote (its result), and the runs' share it blends a disc's with. */
let relief: BankRelief = NO_BANKS;
let runRelief = new Float64Array(0);

/** The relief a levee bank takes at a world point from one body's <Banks/> (`channelBody`, a disc's; −1:
 *  each zone's own, `bodyOfBiome`), into `out` by gate: blended by the current vertex's zone weights like
 *  the heights — each zone's biome's detail layers (or its height noise), plus the same again finer,
 *  scaled, folded to a smooth absolute value. False where no zone in weight has a <Banks/> (`out` zeroed). */
const bodyBankRelief = (x: number, z: number, channelBody: number, bodyOfBiome: (biomeId: number) => number, out: Float64Array): boolean => {
  out.fill(0);
  let weight = 0;
  let any = false;
  for (let i = 0; i < zones.length; i++) {
    if (zoneFinal[i] < ZONE_WEIGHT_EPS) continue;
    const slot = channelBody >= 0 ? channelBody : bodyOfBiome(zones[i].biome.id);
    const banks = slot < 0 ? null : banksOfSlot[slot];
    const noise = banks && domainConfig!.biomeNoiseConfigs[zones[i].biome.id];
    if (!banks || !noise) continue;
    const layers = noiseLayersOf(noise);
    const n = banks.share * (layerSum(layers, x, z) + banks.fineShare * layerSum(layers, x * banks.fineScale, z * banks.fineScale));
    const share = smoothstep(0, BANK_RELIEF_FULL_WEIGHT, zoneFinal[i]);
    out[gateOfSlot[slot]] += share * (Math.sqrt(n * n + 1) - 1);
    weight += share;
    any = true;
  }
  if (weight > 1) for (let g = 0; g < out.length; g++) out[g] /= weight;
  return any;
};

/** The levee relief at a vertex whose channel is a disc by `discShare` (its body `discBody`) and the
 *  runs' by the rest, each zone's run belonging to `runBodyOf` its biome: the two blend by that share —
 *  switched by the heavier body, the relief jumped 6u where a grown pond's share crossed a half. Read while
 *  the zone weights are the vertex's own. The result is this module's scratch, valid until the next call:
 *  step 5 is its last reader, and nothing between re-enters the pipeline (everything that could was
 *  front-loaded into steps 0–2). With no <Banks/> in the domain, or none in weight here, it is NO_BANKS. */
export const bankReliefAt = (x: number, z: number, discBody: number, discShare: number, runBodyOf: (biomeId: number) => number): BankRelief => {
  if (bankGates().length === 0) return NO_BANKS;
  const amounts = relief.amounts;
  const runs = discShare < 1 && bodyBankRelief(x, z, -1, runBodyOf, runRelief);
  if (!(discShare > 0)) {
    if (!runs) return NO_BANKS;
    amounts.set(runRelief);
  } else {
    if (!bodyBankRelief(x, z, discBody, runBodyOf, amounts) && !runs) return NO_BANKS;
    if (!runs) runRelief.fill(0);
    for (let g = 0; g < amounts.length; g++) amounts[g] = runRelief[g] + (amounts[g] - runRelief[g]) * discShare;
  }
  return relief;
};

/** How high a levee's relief lifts its rim over a `drop` (the rim over the raw ground). */
const bankLift = (bank: BankRelief, rimOverGround: number): number => {
  if (!bank.any) return 0;
  const banks = bankGates();
  let lift = 0;
  for (let g = 0; g < banks.length; g++) {
    const amount = bank.amounts[g];
    const drop = Math.min(banks[g].dropCap, rimOverGround);
    if (amount > 0 && drop > 0) lift += amount * smoothstep(banks[g].dropStart, banks[g].dropFull, drop) * (1 + drop / banks[g].dropScale);
  }
  return lift;
};

/** The ground `height` carved by a river at factor-1 `distance` from it, its water at `surface`, width
 *  `factor`; `bank` the levee relief (bankReliefAt; none for a smooth bank); `depth` scales the bed (the
 *  rivers' <Rivers depth>, a pond's kind). */
export const carveRiverChannel = (height: number, distance: number, surface: number, factor: number, bank: BankRelief = NO_BANKS, depth = 1): number => {
  const river = domainConfig!.river;
  const hw = river.halfWidth;
  const reach = hw + river.bank;
  if (distance >= reach) return height;
  const rim = surface + SHORE_RISE + bankLift(bank, surface + SHORE_RISE - height);
  if (distance < hw) {
    const bed = surface - river.depth * Math.sqrt(factor) * depth;
    const u = distance / hw;
    return bed + (rim - bed) * u * u;
  }
  const t = height < rim ? smoothstep(riverWaterBand(river), reach, distance) : smoothstep(hw, reach, distance);
  return rim + (height - rim) * t;
};

/** A wall's shape by its body: a disc's owner's own (every disc-owning body's params carry its walls), else
 *  the runs' here (`runs`). */
const wallOf = (body: number, runs: WallShape): WallShape => (body >= 0 ? (domainConfig!.waterBodies[body].params as WallShape) : runs);

/** The ground `height` cut back to every channel wall in reach (rivers/field.ts riverSample.walls, taken
 *  right after the field is read: a later terrain probe clobbers it — triples of the water, the real
 *  distance past its band and its body: a disc's owner, −1 a river run's), each rising its body's
 *  wallGrade from its water band — a valley, never a slot or a cliff — the lowest winning. It never lowers
 *  ground under a wall's rim, nor raises any. */
export const carveRiverWall = (height: number, walls: readonly number[], runs: WallShape): number => {
  let out = height;
  for (let k = 0; k < walls.length; k += 3) {
    const rim = walls[k] + SHORE_RISE;
    const past = walls[k + 1];
    const body = walls[k + 2];
    const wall = wallOf(body, runs);
    if (!(height > rim) || past >= wall.wallReach) continue;
    const cut = Math.max(rim, smoothMin(height, rim + WALL_ROUND / 4 + wall.wallGrade * past, WALL_ROUND));
    out = Math.min(out, cut + (height - cut) * smoothstep(wall.wallEase, wall.wallReach, past));
  }
  return out;
};
