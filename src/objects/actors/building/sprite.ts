import { reportContentError } from "../../../utils/contentError";
import { seedRand } from "../../../utils/math/_math";
import { packColor, packUnitPair, SPRITE_DATA_FLOATS } from "../../sprite-lod/layout";
import type { SpriteDescription } from "../../sprite-lod/types";
import { generateBuildingPlan } from "./generatePlan";
import { Pt2, ringPoints } from "./rings";
import { BUILDING_HULL_KEYS, buildingSeedAt } from "./spec";
import type { BuildingAttributes, BuildingPlan } from "./types";

/**
 * A building's far sprite (sprite-lod/README.md), a pure function of seed and hull like the plan it comes
 * from: an outline of PROFILE_POINTS heights, each with the building's mean width there and the color of the
 * mass above it, plus a window grid matched to the real window count.
 * The look that draws it is buildingSpriteLook.ts.
 */

export const PROFILE_POINTS = 6;
/** Story and window heights are packed as fractions of this (u). */
export const MAX_PACKED_HEIGHT = 16;
/** Window width ÷ height in the sprite's window grid. */
export const WINDOW_ASPECT = 1.15;
/** Column pitch as a multiple of the window width. */
export const WINDOW_COLUMN_PITCH = 2.2;

// The data layout (floats).
export const OUTLINE_OFFSET = 0; // per profile height: [height ÷ box height, width ÷ box width]
export const COLORS_OFFSET = OUTLINE_OFFSET + PROFILE_POINTS; // each height's band color
export const WINDOW_BAND_OFFSET = COLORS_OFFSET + PROFILE_POINTS; // [lowest window bottom, highest top] ÷ box height
export const WINDOW_SIZE_OFFSET = WINDOW_BAND_OFFSET + 1; // [story height, window height] ÷ MAX_PACKED_HEIGHT
export const GLASS_OFFSET = WINDOW_SIZE_OFFSET + 1;
export const WINDOW_MIX_OFFSET = GLASS_OFFSET + 1; // [fraction of grid cells with a window, light chance]
export const PATTERN_SEED_OFFSET = WINDOW_MIX_OFFSET + 1;
if (PATTERN_SEED_OFFSET >= SPRITE_DATA_FLOATS) {
  throw new Error(`[building sprite] the data layout does not fit the ${SPRITE_DATA_FLOATS} sprite data floats.`);
}

interface OutlinePoint {
  y: number;
  width: number;
  /** The mass above this height. */
  color: number;
}

/** The billboard turns to face the camera, so each ring is drawn at its MEAN width over every view direction:
 *  for a convex ring exactly its perimeter ÷ π (Cauchy). The sideways offset of a leaning ring is ignored. */
const meanWidthOf = (ring: Pt2[]): number => {
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(bx - ax, bz - az);
  }
  return perimeter / Math.PI;
};

const EPSILON = 1e-6;

const sameRing = (a: OutlinePoint, b: OutlinePoint): boolean => Math.abs(a.y - b.y) < EPSILON && Math.abs(a.width - b.width) < EPSILON;

/** The body masses and the hip roof, bottom to top; roof caps and pipes are left out, as the proxy hull
 *  leaves them out. A mass sitting flush on the one below shares its ring, which takes the upper color. */
const outlineOf = (plan: BuildingPlan): OutlinePoint[] => {
  const outline: OutlinePoint[] = [];
  plan.lofts.forEach((loft, loftIndex) => {
    if (loftIndex >= plan.bodyLoftCount && !loft.points) return;
    loft.levels.forEach((level, i) => {
      const ring = loft.points?.[i] ?? ringPoints(loft.rect, loft.sides, level, loft.ringRotation);
      const below = outline[outline.length - 1];
      const point = { y: Math.max(0, level.y, below?.y ?? 0), width: meanWidthOf(ring), color: loft.color };
      if (below && sameRing(below, point)) outline[outline.length - 1] = point;
      else outline.push(point);
    });
  });
  return outline;
};

const widthBetween = (a: OutlinePoint, b: OutlinePoint, y: number): number => {
  const span = b.y - a.y;
  const t = span > 0 ? (y - a.y) / span : 0;
  return a.width + (b.width - a.width) * t;
};

const widthAt = (outline: OutlinePoint[], y: number): number => {
  for (let i = 0; i < outline.length - 1; i++) {
    if (y <= outline[i + 1].y) return widthBetween(outline[i], outline[i + 1], Math.max(y, outline[i].y));
  }
  return outline[outline.length - 1].width;
};

/** How far the outline moves where point i is dropped. */
const removalError = (outline: OutlinePoint[], i: number): number =>
  Math.abs(outline[i].width - widthBetween(outline[i - 1], outline[i + 1], outline[i].y));

/** Ranks every color boundary after every other height. */
const COLOR_BOUNDARY_COST = 1e9;

/** Drops the heights that change the outline least, color boundaries last; a dropped boundary's merged band
 *  takes the color that covered more of it. Short outlines are padded with their top. */
const simplifyOutline = (outline: OutlinePoint[]): OutlinePoint[] => {
  const points = outline.map((p) => ({ ...p }));
  while (points.length > PROFILE_POINTS) {
    let drop = -1;
    let dropCost = Infinity;
    for (let i = 1; i < points.length - 1; i++) {
      const boundary = points[i - 1].color !== points[i].color;
      const cost = removalError(points, i) + (boundary ? COLOR_BOUNDARY_COST : 0);
      if (cost < dropCost) {
        dropCost = cost;
        drop = i;
      }
    }
    const [below, dropped, above] = [points[drop - 1], points[drop], points[drop + 1]];
    if (above.y - dropped.y > dropped.y - below.y) below.color = dropped.color;
    points.splice(drop, 1);
  }
  while (points.length < PROFILE_POINTS) points.push({ ...points[points.length - 1] });
  return points;
};

interface WindowGrid {
  bottom: number;
  top: number;
  storyHeight: number;
  windowHeight: number;
  /** Fraction of grid cells that hold a window. */
  fill: number;
}

const NO_WINDOWS: WindowGrid = { bottom: 0, top: 0, storyHeight: 0, windowHeight: 0, fill: 0 };

/** One row per story over the windowed band; the fill matches the real window count to the slots such a grid
 *  offers around the whole building (perimeter = π × mean width). */
const windowGridOf = (plan: BuildingPlan, outline: OutlinePoint[], height: number): WindowGrid => {
  if (plan.windows.length === 0) return NO_WINDOWS;
  const bottom = Math.max(0, Math.min(...plan.windows.map((w) => w.y - w.h / 2)));
  const top = Math.min(height, Math.max(...plan.windows.map((w) => w.y + w.h / 2)));
  const windowHeight = plan.windows.reduce((sum, w) => sum + w.h, 0) / plan.windows.length;
  const { storyHeight } = plan.interior;
  if (storyHeight > MAX_PACKED_HEIGHT || windowHeight > MAX_PACKED_HEIGHT) {
    reportContentError(
      `[building sprite] a ${storyHeight.toFixed(2)}u story (${windowHeight.toFixed(2)}u windows) is past the sprite's ` +
        `${MAX_PACKED_HEIGHT}u packing ceiling (MAX_PACKED_HEIGHT, building/sprite.ts).`,
    );
  }
  if (top <= bottom) return NO_WINDOWS;

  // The look's rows: whole stories stretched to the band. Each offers as many columns as its own perimeter
  // holds, so a podium under a slim tower counts its wider rows.
  const rows = storyHeight > 0 ? Math.max(1, Math.round((top - bottom) / storyHeight)) : 1;
  const rowHeight = (top - bottom) / rows;
  const pitch = windowHeight * WINDOW_ASPECT * WINDOW_COLUMN_PITCH;
  let slots = 0;
  for (let row = 0; row < rows; row++) {
    const y = bottom + (row + 0.5) * rowHeight;
    slots += Math.max(1, Math.floor((Math.PI * widthAt(outline, y)) / pitch));
  }
  return { bottom, top, storyHeight, windowHeight, fill: Math.min(1, plan.windows.length / slots) };
};

const packSprite = (plan: BuildingPlan, seed: string): SpriteDescription | null => {
  const outline = outlineOf(plan);
  if (outline.length < 2) return null;
  const profile = simplifyOutline(outline);
  const height = profile[profile.length - 1].y;
  const width = Math.max(...profile.map((p) => p.width));
  if (!(height > 0) || !(width > 0)) return null;

  const data = new Array<number>(SPRITE_DATA_FLOATS).fill(0);
  profile.forEach((p, j) => {
    data[OUTLINE_OFFSET + j] = packUnitPair(p.y / height, p.width / width);
    data[COLORS_OFFSET + j] = packColor(p.color);
  });

  const windows = windowGridOf(plan, outline, height);
  data[WINDOW_BAND_OFFSET] = packUnitPair(windows.bottom / height, windows.top / height);
  data[WINDOW_SIZE_OFFSET] = packUnitPair(windows.storyHeight / MAX_PACKED_HEIGHT, windows.windowHeight / MAX_PACKED_HEIGHT);
  data[GLASS_OFFSET] = packColor(plan.windows[0]?.glass ?? 0);
  data[WINDOW_MIX_OFFSET] = packUnitPair(windows.fill, plan.windowLightChance);
  data[PATTERN_SEED_OFFSET] = seedRand(`sprite:${seed}`);

  return { width, height, data };
};

/** The SPRITE_DESCRIBERS entry for buildings: the plan Building.tsx generates at this spawn point (the `seed`
 *  attribute, else the position seed, and exactly its hull attributes), so the size is the real one. */
export const describeBuildingSprite = (attributes: Readonly<Record<string, unknown>>, x: number, z: number): SpriteDescription | null => {
  const seed = attributes.seed !== undefined ? String(attributes.seed) : buildingSeedAt(x, z);
  const hull: Record<string, unknown> = {};
  for (const key of BUILDING_HULL_KEYS) hull[key] = attributes[key];
  return packSprite(generateBuildingPlan(seed, hull as BuildingAttributes), seed);
};
