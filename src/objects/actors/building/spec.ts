import type { ActorAttributes } from "../../types";
import type { ActorSpec } from "../spec";
import type { SpriteLodAttributes } from "../../sprite-lod/types";
import { BuildingAttributes, LIGHT_TYPE, ROOF_STYLE } from "./types";

// The server (physics/buildings.ts) generates the SAME plan from a spec's `hull` to build the
// sealed collider, and its domain config derives the flatten pads from the placement here — a
// building kind's shape and placement are defined once, in its spec.

/** Every generation attribute (BuildingAttributes minus the shared actor ones): what Building.tsx
 *  generates its plan from, and the keys a mount must not override (spec.ts `mountOverridesOf`). The
 *  Record makes a new attribute a compile error until it is listed. */
type BuildingHullKey = Exclude<keyof BuildingAttributes, keyof ActorAttributes>;
const HULL_KEY_SET: Record<BuildingHullKey, true> = {
  exteriorSize: true,
  numberOfSides: true,
  widthScale: true,
  aspectRange: true,
  roof: true,
  roofColors: true,
  lightType: true,
  palette: true,
  accentColors: true,
  accentChance: true,
  windowShapes: true,
  windowCount: true,
  windowSize: true,
  maxLean: true,
  shellHeightRange: true,
  stories: true,
  roomCount: true,
  doorCount: true,
  doorSize: true,
  ceilingHeight: true,
  windowLightChance: true,
  windowLightIntensity: true,
  interiorColors: true,
};
export const BUILDING_HULL_KEYS = Object.keys(HULL_KEY_SET) as readonly BuildingHullKey[];

/** A building's default seed: its spawn position, rounded — so the client (Building.tsx) and the
 *  server (physics/buildings.ts) generate the same plan for the same spot. */
export const buildingSeedAt = (x: number, z: number): string => `${Math.round(x)}_${Math.round(z)}`;

export const BUILDING_ATTRS: BuildingAttributes = {};

/** Farthest ray distance (eye → leaf) a door can be hovered/clicked from. The server measures a door
 *  click from the DOOR's position in the seeded plan, plus INTERACT_REACH_SLACK (a building's origin is
 *  its center, and facade doors sit 9–16u from it — measured over 200 seeds). */
export const DOOR_INTERACT_REACH = 6;

/** Every building kind's far tier: the whole skyline as sprites out to here; the full building hands off at
 *  its renderDistance. At 600u a 95u skyscraper is ~110px tall at 1080p, so an earlier handoff shows the flat
 *  sprite (building/DECISIONS.md). */
export const BUILDING_SPRITE_LOD: SpriteLodAttributes = { renderDistance: 3000 };

/** Max floors under a much taller shell (mechanical levels), a gentler lean so tall
 *  neighbors don't collide, most windows lit so towers read as busy from afar. */
const SKYSCRAPER_ATTRS: BuildingAttributes = {
  stories: 6,
  roomCount: [3, 4, 5, 6],
  shellHeightRange: [70, 115],
  maxLean: 0.04,
  windowLightChance: 0.8,
};

/** Buildings only place inside block interiors, so density is high to keep blocks
 *  packed — footprint spacing is the real limiter (half this density visibly thins the
 *  city). flattenGround: sloped block interiors otherwise clip floors. Footprint and road
 *  setback are sized for the widest shell (widthScale up to 1.5×; was 30 / 23 at 1×). */
export const BUILDING_SPEC: ActorSpec = {
  id: "building",
  component: "building",
  renderDistance: 625,
  frustumPadding: 3.25,
  footprint: 40,
  density: 3800,
  clustering: 0,
  priority: 55,
  roadDistanceRange: [28, 99999],
  flattenGround: true,
  spriteLod: BUILDING_SPRITE_LOD,
  hull: BUILDING_ATTRS,
};

/** Deep block interiors only, so density is raised to keep the skyline populated. */
export const SKYSCRAPER_SPEC: ActorSpec = {
  ...BUILDING_SPEC,
  id: "skyscraper",
  footprint: 48,
  density: 240,
  priority: 45,
  roadDistanceRange: [33, 99999],
  hull: SKYSCRAPER_ATTRS,
};

/** Siding and paint: lighter and warmer than the city's concrete. */
const HOUSE_PALETTE = [0xe8dcc0, 0xd9c7a3, 0xc9d3b4, 0xa9bfa0, 0xb7c9d6, 0x9fb4c7, 0xe3d27f, 0xd8a48f, 0xb5654a, 0xf0ece2];
const HOUSE_ACCENTS = [0x8a3b32, 0x3f5a73, 0x5b6e3f, 0x6d4c7a];

/** 1–2 stories of 2–4 rooms under a hip roof on a 3–5-sided plan (mostly 4), with lower ceilings
 *  than the city's. */
const HOUSE_ATTRS: BuildingAttributes = {
  roof: ROOF_STYLE.PITCHED,
  numberOfSides: [3, 4, 4, 4, 5],
  aspectRange: [0.6, 1 / 0.6],
  stories: [1, 2],
  roomCount: [2, 3, 4],
  ceilingHeight: 5.52,
  palette: HOUSE_PALETTE,
  accentColors: HOUSE_ACCENTS,
  accentChance: 0.12,
  windowSize: [1.6, 2.6],
  windowLightChance: 0.3, // half the city default (0.6): fewer homes are up at night
  lightType: LIGHT_TYPE.DOME,
};

/** The grassland's scattered houses; the grass biome's mount sets the density. */
export const HOUSE_SPEC: ActorSpec = { ...BUILDING_SPEC, id: "house", hull: HOUSE_ATTRS };
