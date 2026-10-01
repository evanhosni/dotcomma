import seedrandom from "seedrandom";
import { clamp } from "../../../utils/math/_math";
import {
  edgeLength,
  edgeNormal,
  edgePoint,
  inscribedRectFactor,
  pointInRing,
  Pt2,
  RECT_EDGE,
  ringPoints,
  ringSpanAt,
} from "./rings";
import {
  BuildingAttributes,
  BuildingPlan,
  ChildSlot,
  DoorPlan,
  ExteriorLoft,
  RampSpec,
  RingLevel,
  RoomRect,
  WallBox,
  WallSide,
  WINDOW_SHAPE,
} from "./types";

/**
 * BuildingAttributes + a seed → a pure-data BuildingPlan. Interior-first: rooms × floors size the
 * exterior. Pure and deterministic — the server generates the same plan for its hull collider — so
 * every roll goes through ONE seeded stream in a fixed order: reordering any two rolls (or any two
 * phases below) moves every building in the world.
 */

const WALL_THICKNESS = 0.24;
export const SLAB_THICKNESS = 0.3;
/** Ground-floor top above grade, so flat terrain never z-fights through the floor. */
export const FLOOR_LIFT = 0.12;
export const RAMP_THICKNESS = 0.25;
export const RAMP_WIDTH = 2.0; // ramp lane width
const WALKWAY_WIDTH = 1.8; // sizing allowance beside the lane so the room around a shaft stays walkable
const RAMP_LANDING = 1.2; // solid floor at each end of the run
/** Shaft inset from the BSP domain edges, so ramp faces never sit flush against the shell. */
const RAMP_MARGIN = 0.3;
const RAMP_RUN_FACTOR = 1.5; // run = storyHeight × this (≈34° slope)
const RAMP_RUN_MIN_FACTOR = 1.25; // steepest allowed fit (≈39°) before giving up on stories
const DOORWAY_WIDTH = 2.4; // interior room-to-room openings
const DOORWAY_HEIGHT = 4.2;
const MIN_ROOM_DIM = 6; // rooms below 2× this never split again
const LIGHT_PANEL_SPACING = 5.5;
const CHILD_SLOT_COUNT = 32;
const FOUNDATION_DEPTH = 1;
/** Exterior half-extent minus the interior's: the shell's thickness at the door band. */
const SHELL_INSET = 0.24;
/** Interior half-extent cap for a sized (not `exteriorSize`d) building, so shells never intersect at the spawn spacing. */
const MAX_INTERIOR_HALF = 13;
/** How far a multi-story interior may grow to fit its ramp shaft. */
const MAX_GROWN_INTERIOR_HALF = 16;
const MAX_STORIES = 6;

const SIDES: WallSide[] = ["+z", "-z", "+x", "-x"];

const GRAYSCALE = [0x2e3134, 0x45484c, 0x5a5e63, 0x6f7378, 0x84888d, 0x9aa0a5, 0xb4b9be, 0xd0d4d8];
const ACCENTS = [0x5b8fc7, 0x6f5fb5, 0x8d7ec9, 0x9c3f3f, 0xb0632f, 0x8a5a33, 0x3f7f86];
const DEFAULT_SIDES = [4, 5, 6, 7, 8];
const DEFAULT_WINDOW_SIZE: [number, number] = [2.4, 4.4];
const GLASS_COLORS = [0x9fd8ec, 0x8ec7de, 0xaad4ea];
const PIPE_COLORS = [0x6b4a2f, 0x8a8f96, 0x3c4046];
const DOOR_BROWNS = [0x4a352a, 0x5a4030, 0x6b4a2f, 0x7a5a3a, 0x8a6a4a];

const WINDOW_ROW_SPACING = 6.0;

/** A BSP split wall at `at` on `axis`, running `from`..`to` along the other axis. */
interface SplitWall {
  axis: "x" | "z";
  at: number;
  from: number;
  to: number;
  doorAt: number;
}

/** One story's BSP result: its leaf rooms, their split walls, and the rects (shafts, arrival holes) walls avoid. */
interface StoryLayout {
  rooms: RoomRect[];
  splitWalls: SplitWall[];
  obstacles: RoomRect[];
}

const shade = (hex: number, f: number): number => {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
};

const rectsOverlap = (a: RoomRect, b: RoomRect, m: number): boolean =>
  a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

/** The plan's one seeded random stream. */
interface PlanRng {
  (): number;
  range(a: number, b: number): number;
  rangeInt(a: number, b: number): number;
  pick<T>(arr: T[]): T;
  shuffle<T>(arr: T[]): T[];
}

const createPlanRng = (seed: string): PlanRng => {
  const rng = seedrandom(`building:${seed}`);
  const planRng = (() => rng()) as PlanRng;
  planRng.range = (a, b) => a + rng() * (b - a);
  planRng.rangeInt = (a, b) => Math.floor(a + rng() * (b + 1 - a));
  planRng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  planRng.shuffle = (arr) => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  return planRng;
};

/** Everything the phases after sizing share: the shell's shape, the story dimensions, the interior
 *  footprint and the BSP domain rooms are split within. */
interface Massing {
  sides: number;
  rect: boolean;
  ringRotation: number;
  ceilingHeight: number;
  storyHeight: number;
  doorWidth: number;
  doorHeight: number;
  doorBandTop: number;
  /** After the ramp fit — may be fewer than requested. */
  stories: number;
  requestedStories: number;
  pickRoomCount: () => number;
  rampRun: number;
  shaftLen: number;
  interiorHalfWidth: number;
  interiorHalfDepth: number;
  /** Exterior half-extents at ground level. */
  halfWidth: number;
  halfDepth: number;
  /** The interior perimeter polygon. */
  intPts: Pt2[];
  /** The BSP domain: only room BOOKKEEPING — split walls are later stretched past it to the shell's
   *  inner surface (no enclosed room-within-a-room). */
  bsp: RoomRect;
}

export const generateBuildingPlan = (seed: string, opts: BuildingAttributes): BuildingPlan => {
  const rng = createPlanRng(seed);
  const m = sizeMassing(rng, opts);
  const shellHeight = chooseShellHeight(rng, opts, m);
  const ringAt = createShellRings(rng, opts, m, shellHeight);
  const segmentColor = createSegmentColors(rng, opts);
  const { lofts, bandTop, bandColor, segBounds } = buildLofts(rng, m, shellHeight, ringAt, segmentColor);
  const interiorColors = interiorColorsOf(opts, bandColor);
  const doorColor = chooseDoorColor(rng, lofts);
  const bandPts = ringPoints(m.rect, m.sides, bandTop, m.ringRotation);
  const doors = placeDoors(rng, opts, m, bandPts);
  const windows = placeWindows(rng, opts, lofts, segBounds, bandPts);
  const { ramps, storyLayouts } = layoutStories(rng, m, doors);
  stretchSplitWallsToShell(storyLayouts, m);
  const wallBoxesPerStory = buildWallBoxes(rng, storyLayouts, m.ceilingHeight);
  nudgeDoorsClearOfWalls(doors, storyLayouts[0].splitWalls, m.intPts, bandPts);
  const lightPanelsPerStory = placeLightPanels(rng, m, ramps);
  const childSlots = placeChildSlots(rng, m, storyLayouts, ramps);

  return {
    seed,
    footprint: [2 * m.halfWidth, 2 * m.halfDepth],
    height: shellHeight,
    doorBandTop: m.doorBandTop,
    foundationDepth: FOUNDATION_DEPTH,
    lofts,
    bodyLoftCount: 1 + segBounds.length,
    doors,
    doorColor,
    windowLightChance: clamp(opts.windowLightChance ?? 0.6, 0, 1),
    windowLightIntensity: Math.max(0, opts.windowLightIntensity ?? 1.4),
    windows,
    interior: {
      width: 2 * m.interiorHalfWidth,
      depth: 2 * m.interiorHalfDepth,
      ceilingHeight: m.ceilingHeight,
      colors: interiorColors,
      stories: m.stories,
      storyHeight: m.storyHeight,
      roomsPerStory: storyLayouts.map((l) => l.rooms),
      wallBoxesPerStory,
      ramps,
      lightPanelsPerStory,
      childSlots,
    },
  };
};

// ─── Massing: shape, stories, interior footprint ────────────────────────────

const sizeMassing = (rng: PlanRng, opts: BuildingAttributes): Massing => {
  const sideChoices = opts.numberOfSides?.length ? opts.numberOfSides : DEFAULT_SIDES;
  const sides = Math.max(3, Math.round(rng.pick(sideChoices)));
  const rect = sides === 4;
  const ringRotation = rect ? 0 : rng.range(0, Math.PI * 2);

  const ceilingHeight = opts.ceilingHeight ?? 6;
  const storyHeight = ceilingHeight + SLAB_THICKNESS;
  const doorWidth = opts.doorSize?.[0] ?? 2.6;
  const doorHeight = Math.min(opts.doorSize?.[1] ?? 3.2, ceilingHeight - 0.2);
  const doorBandTop = doorHeight + rng.range(0.8, 2);

  const requestedStories = clamp(Math.round(opts.stories ?? rng.rangeInt(1, 5)), 1, MAX_STORIES);
  const roomChoices = (
    Array.isArray(opts.roomCount) ? opts.roomCount : opts.roomCount !== undefined ? [opts.roomCount] : null
  )?.map((n) => Math.max(1, Math.round(n)));
  const pickRoomCount = (): number => (roomChoices?.length ? rng.pick(roomChoices) : rng.rangeInt(3, 6));
  // A floor rolling more rooms than fit just gets a denser split (BSP stops early).
  const maxRoomCount = roomChoices?.length ? Math.max(...roomChoices) : rng.rangeInt(4, 6);
  const roomArea = rng.range(70, 110);
  const shaftLen = storyHeight * RAMP_RUN_FACTOR + 2 * RAMP_LANDING;
  const shaftWidth = RAMP_WIDTH + WALKWAY_WIDTH;
  // Near-square when multi-story so the inscribed room block fits the shaft.
  const aspect = requestedStories > 1 ? rng.range(0.92, 1.08) : rng.range(0.8, 1.25);

  let interiorHalfWidth: number;
  let interiorHalfDepth: number;
  if (opts.exteriorSize) {
    interiorHalfWidth = Math.max(4, opts.exteriorSize[0] / 2 - SHELL_INSET);
    interiorHalfDepth = Math.max(4, opts.exteriorSize[2] / 2 - SHELL_INSET);
  } else {
    const needed = maxRoomCount * roomArea + (requestedStories > 1 ? shaftLen * shaftWidth * 1.4 : 0);
    const unitPts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, halfWidth: 1, halfDepth: aspect }, ringRotation);
    const f = rect ? 1 : inscribedRectFactor(unitPts, 1, aspect);
    const s = Math.sqrt(needed / (4 * f * f * aspect));
    interiorHalfWidth = s;
    interiorHalfDepth = s * aspect;
    const maxHalf = Math.max(interiorHalfWidth, interiorHalfDepth);
    if (maxHalf > MAX_INTERIOR_HALF) {
      interiorHalfWidth *= MAX_INTERIOR_HALF / maxHalf;
      interiorHalfDepth *= MAX_INTERIOR_HALF / maxHalf;
    }
  }

  const blockOf = (halfW: number, halfD: number) => {
    const pts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, halfWidth: halfW, halfDepth: halfD }, ringRotation);
    const f2 = rect ? 1 : inscribedRectFactor(pts, halfW, halfD, 0.4);
    return { pts, halfW: Math.max(4, f2 * halfW), halfD: Math.max(4, f2 * halfD) };
  };
  let block = blockOf(interiorHalfWidth, interiorHalfDepth);
  if (requestedStories > 1 && !opts.exteriorSize) {
    // Grow until the BSP block fits the steepest allowed shaft.
    const needHalfW = (storyHeight * RAMP_RUN_MIN_FACTOR + 2 * RAMP_LANDING + 2.6) / 2;
    const needHalfD = (shaftWidth + 4) / 2;
    for (
      let i = 0;
      i < 6 &&
      (block.halfW < needHalfW || block.halfD < needHalfD) &&
      Math.max(interiorHalfWidth, interiorHalfDepth) < MAX_GROWN_INTERIOR_HALF;
      i++
    ) {
      interiorHalfWidth = Math.min(MAX_GROWN_INTERIOR_HALF, interiorHalfWidth * 1.1);
      interiorHalfDepth = Math.min(MAX_GROWN_INTERIOR_HALF, interiorHalfDepth * 1.1);
      block = blockOf(interiorHalfWidth, interiorHalfDepth);
    }
  }
  const bsp: RoomRect = { x0: -block.halfW, z0: -block.halfD, x1: block.halfW, z1: block.halfD };

  // Prefer the ≈34° run, steepen to ≈39°, and only as a last resort give up on stories.
  let stories = requestedStories;
  let rampRun = storyHeight * RAMP_RUN_FACTOR;
  let fittedShaftLen = shaftLen;
  if (stories > 1) {
    const maxShaftLen = bsp.x1 - bsp.x0 - 2.5;
    if (fittedShaftLen > maxShaftLen) {
      rampRun = maxShaftLen - 2 * RAMP_LANDING;
      fittedShaftLen = maxShaftLen;
    }
    if (rampRun < storyHeight * RAMP_RUN_MIN_FACTOR || bsp.z1 - bsp.z0 < shaftWidth + 4) stories = 1;
  }

  return {
    sides,
    rect,
    ringRotation,
    ceilingHeight,
    storyHeight,
    doorWidth,
    doorHeight,
    doorBandTop,
    stories,
    requestedStories,
    pickRoomCount,
    rampRun,
    shaftLen: fittedShaftLen,
    interiorHalfWidth,
    interiorHalfDepth,
    halfWidth: opts.exteriorSize ? opts.exteriorSize[0] / 2 : interiorHalfWidth + SHELL_INSET,
    halfDepth: opts.exteriorSize ? opts.exteriorSize[2] / 2 : interiorHalfDepth + SHELL_INSET,
    intPts: block.pts,
    bsp,
  };
};

/** shellHeightRange only applies when the floors it advertises actually exist. */
const chooseShellHeight = (rng: PlanRng, opts: BuildingAttributes, m: Massing): number => {
  if (opts.exteriorSize) return opts.exteriorSize[1];
  if (opts.shellHeightRange && m.stories === m.requestedStories) {
    return Math.max(rng.range(opts.shellHeightRange[0], opts.shellHeightRange[1]), m.stories * m.storyHeight + 2);
  }
  if (m.stories === 1) return m.storyHeight + rng.range(3, 16);
  // Even the shortest 2-story shell clears the tallest 1-story one, and a
  // shell of height H never suggests FEWER floors than it has (~30u ⇒ 2, ~48u ⇒ 3, ~60u ⇒ 4).
  return m.stories * m.storyHeight + rng.range(8, 12) + m.stories * (m.stories <= 2 ? rng.range(2.5, 4.5) : rng.range(5, 7));
};

// ─── Exterior: lofted masses, roof caps, pipes ──────────────────────────────

/** A shell cross-section at height y, scaled by rScale. Rings up to interiorTop are clamped to wrap the
 *  interior prism; above it the shell leans/tapers freely. */
type ShellRingAt = ((y: number, rScale: number) => RingLevel) & {
  interiorTop: number;
  /** Clearance a ring leaning by `lean` keeps around the interior. */
  clampMargin: (lean: number) => number;
};

const createShellRings = (rng: PlanRng, opts: BuildingAttributes, m: Massing, shellHeight: number): ShellRingAt => {
  const interiorTop = m.stories * m.storyHeight + 0.5;
  const leanAngle = rng.range(0, Math.PI * 2);
  const leanMag = rng.range(0, opts.maxLean ?? 0.08) * shellHeight;
  const leanExp = rng.range(1.2, 1.9);
  const topScale = rng.range(0.7, 1.25);
  // Polygon faces sit at apothem distance (over-provision by 1/cos(π/N)); the
  // FULL lean is charged to both axes, since per-axis components under-cover diagonals.
  const apothem = m.rect ? 1 : Math.cos(Math.PI / m.sides);
  const clampMargin = (lean: number): number => (0.9 + lean) / apothem;
  const ringAt = (y: number, rScale: number): RingLevel => {
    const t = clamp((y - m.doorBandTop) / Math.max(shellHeight - m.doorBandTop, 1e-6), 0, 1);
    const lean = leanMag * Math.pow(t, leanExp);
    const g = 1 + (topScale - 1) * Math.pow(t, 1.15);
    const cx = Math.cos(leanAngle) * lean;
    const cz = Math.sin(leanAngle) * lean;
    let ringHalfWidth = m.halfWidth * g * rScale;
    let ringHalfDepth = m.halfDepth * g * rScale;
    if (y <= interiorTop) {
      const margin = clampMargin(lean);
      ringHalfWidth = Math.max(ringHalfWidth, m.interiorHalfWidth + margin);
      ringHalfDepth = Math.max(ringHalfDepth, m.interiorHalfDepth + margin);
    }
    return { y, cx, cz, halfWidth: ringHalfWidth, halfDepth: ringHalfDepth };
  };
  return Object.assign(ringAt, { interiorTop, clampMargin });
};

/** The primary color is rolled once; each segment mostly repeats it. */
const createSegmentColors = (rng: PlanRng, opts: BuildingAttributes): (() => number) => {
  const palette = opts.palette?.length ? opts.palette : GRAYSCALE;
  const accents = opts.accentColors?.length ? opts.accentColors : ACCENTS;
  const accentChance = opts.accentChance ?? 0.2;
  const primary = rng() < accentChance ? rng.pick(accents) : rng.pick(palette);
  return () => (rng() < 0.55 ? primary : rng() < accentChance * 0.4 ? rng.pick(accents) : rng.pick(palette));
};

interface SegmentBounds {
  loft: number;
  y0: number;
  y1: number;
}

const buildLofts = (
  rng: PlanRng,
  m: Massing,
  shellHeight: number,
  ringAt: ShellRingAt,
  segmentColor: () => number,
): { lofts: ExteriorLoft[]; bandTop: RingLevel; bandColor: number; segBounds: SegmentBounds[] } => {
  const { rect, sides, ringRotation } = m;
  // Door band: the prismatic ground section the doors are carved into.
  const bandColor = segmentColor();
  const bandBot: RingLevel = { y: -FOUNDATION_DEPTH, cx: 0, cz: 0, halfWidth: m.halfWidth, halfDepth: m.halfDepth };
  const bandTop: RingLevel = { ...bandBot, y: m.doorBandTop };
  const lofts: ExteriorLoft[] = [{ rect, sides, ringRotation, levels: [bandBot, bandTop], color: bandColor, hasRoofFan: false }];

  const segCount = rng.rangeInt(2, 4);
  const weights = Array.from({ length: segCount }, () => rng.range(0.6, 1.6));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const segBounds: SegmentBounds[] = [];
  let y0 = m.doorBandTop;
  let prevTop = bandTop;
  for (let k = 0; k < segCount; k++) {
    const y1 = k === segCount - 1 ? shellHeight : y0 + ((shellHeight - m.doorBandTop) * weights[k]) / weightSum;
    const rScale = rng.range(0.9, 1.1);
    const levels: RingLevel[] = [
      { ...prevTop }, // continuity with the mass below; the lip step is the next level
      ringAt(y0 + 0.06, rScale * rng.range(1.0, 1.07)),
      ringAt((y0 + y1) / 2, rScale * rng.range(0.97, 1.1)),
      ringAt(y1, rScale * rng.range(0.92, 1.02)),
    ];
    insertInteriorTopRing(levels, ringAt, m);
    lofts.push({ rect, sides, ringRotation, levels, color: segmentColor(), hasRoofFan: k === segCount - 1 });
    segBounds.push({ loft: lofts.length - 1, y0, y1 });
    prevTop = levels[levels.length - 1];
    y0 = y1;
  }

  const capTop = addRoofCaps(rng, m, lofts, prevTop, segmentColor);
  addRoofPipes(rng, m, lofts, capTop);
  return { lofts, bandTop, bandColor, segBounds };
};

/** ringAt clamps only AT levels: a wall lerping from a clamped ring to a tapered one above
 *  interiorTop would slice the interior's top corner, so a clamped ring is inserted exactly there. */
const insertInteriorTopRing = (levels: RingLevel[], ringAt: ShellRingAt, m: Massing): void => {
  const { interiorTop } = ringAt;
  for (let i = 0; i < levels.length - 1; i++) {
    const A = levels[i];
    const B = levels[i + 1];
    if (A.y < interiorTop && B.y > interiorTop) {
      const t = (interiorTop - A.y) / (B.y - A.y);
      const cx = A.cx + (B.cx - A.cx) * t;
      const cz = A.cz + (B.cz - A.cz) * t;
      const margin = ringAt.clampMargin(Math.hypot(cx, cz));
      levels.splice(i + 1, 0, {
        y: interiorTop,
        cx,
        cz,
        halfWidth: Math.max(A.halfWidth + (B.halfWidth - A.halfWidth) * t, m.interiorHalfWidth + margin),
        halfDepth: Math.max(A.halfDepth + (B.halfDepth - A.halfDepth) * t, m.interiorHalfDepth + margin),
      });
      return;
    }
  }
};

/** Pulls a roof decoration inward just until its base sits on the roof polygon (clamps, never re-centers). */
const fitOnRoof = (
  m: Massing,
  roof: RingLevel,
  x: number,
  z: number,
  basePts: (x: number, z: number) => Pt2[],
): [number, number] => {
  const roofPts = ringPoints(m.rect, m.sides, roof, m.ringRotation);
  for (let i = 0; i < 6; i++) {
    if (basePts(x, z).every((p) => pointInRing(roofPts, p, 0.05))) return [x, z];
    x = roof.cx + (x - roof.cx) * 0.6;
    z = roof.cz + (z - roof.cz) * 0.6;
  }
  return [roof.cx, roof.cz];
};

/** 0–2 stacked roof masses; returns the top the pipes stand on. */
const addRoofCaps = (
  rng: PlanRng,
  m: Massing,
  lofts: ExteriorLoft[],
  roof: RingLevel,
  segmentColor: () => number,
): RingLevel => {
  const { rect, sides, ringRotation } = m;
  let capBase = roof;
  const capCount = rng.rangeInt(0, 2);
  for (let i = 0; i < capCount; i++) {
    const cw = capBase.halfWidth * rng.range(0.3, 0.55);
    const cd = capBase.halfDepth * rng.range(0.3, 0.55);
    const capHeight = rng.range(1.5, 4) * (i === 0 ? 1.3 : 0.8);
    const [ccx, ccz] = fitOnRoof(
      m,
      capBase,
      capBase.cx + rng.range(-1, 1) * (capBase.halfWidth - cw) * 0.5,
      capBase.cz + rng.range(-1, 1) * (capBase.halfDepth - cd) * 0.5,
      (x, z) => ringPoints(rect, sides, { y: 0, cx: x, cz: z, halfWidth: cw, halfDepth: cd }, ringRotation),
    );
    const top: RingLevel = {
      y: capBase.y + capHeight,
      cx: ccx,
      cz: ccz,
      halfWidth: cw * rng.range(0.8, 1),
      halfDepth: cd * rng.range(0.8, 1),
    };
    lofts.push({
      rect,
      sides,
      ringRotation,
      levels: [{ y: capBase.y, cx: ccx, cz: ccz, halfWidth: cw, halfDepth: cd }, top],
      color: segmentColor(),
      hasRoofFan: true,
    });
    capBase = top;
  }
  return capBase;
};

/** 0–2 crooked octagonal pipes on the roof. */
const addRoofPipes = (rng: PlanRng, m: Massing, lofts: ExteriorLoft[], roof: RingLevel): void => {
  const pipeCount = rng.rangeInt(0, 2);
  for (let p = 0; p < pipeCount; p++) {
    const pr = rng.range(0.25, 0.5);
    const [px, pz] = fitOnRoof(
      m,
      roof,
      roof.cx + rng.range(-1, 1) * Math.max(0, roof.halfWidth - pr - 0.2),
      roof.cz + rng.range(-1, 1) * Math.max(0, roof.halfDepth - pr - 0.2),
      (x, z) => ringPoints(false, 8, { y: 0, cx: x, cz: z, halfWidth: pr, halfDepth: pr }, 0),
    );
    const bend = rng.range(0, Math.PI * 2);
    const y1 = roof.y + rng.range(0.8, 2);
    const y2 = y1 + rng.range(0.5, 1.1);
    const reach = rng.range(0.5, 1.3);
    const levels: RingLevel[] = [
      { y: roof.y - 0.2, cx: px, cz: pz, halfWidth: pr, halfDepth: pr },
      { y: y1, cx: px, cz: pz, halfWidth: pr, halfDepth: pr },
      { y: y2, cx: px + Math.cos(bend) * reach, cz: pz + Math.sin(bend) * reach, halfWidth: pr, halfDepth: pr },
    ];
    if (rng() < 0.5) {
      levels.push({
        y: y2 + rng.range(0.4, 1),
        cx: px + Math.cos(bend) * reach * 1.6,
        cz: pz + Math.sin(bend) * reach * 1.6,
        halfWidth: pr,
        halfDepth: pr,
      });
    }
    lofts.push({ rect: false, sides: 8, ringRotation: 0, levels, color: rng.pick(PIPE_COLORS), hasRoofFan: true });
  }
};

const interiorColorsOf = (opts: BuildingAttributes, bandColor: number) => {
  const wall = opts.interiorColors?.wall ?? bandColor;
  return {
    wall,
    floor: opts.interiorColors?.floor ?? shade(wall, 0.65),
    ceiling: opts.interiorColors?.ceiling ?? shade(wall, 1.3),
    ramp: opts.interiorColors?.ramp ?? shade(wall, 0.8),
  };
};

/** Doors never introduce a new bright hue. */
const chooseDoorColor = (rng: PlanRng, lofts: ExteriorLoft[]): number => {
  const doorRoll = rng();
  if (doorRoll < 0.4) return rng.pick(lofts.map((l) => l.color));
  return doorRoll < 0.7 ? rng.pick(DOOR_BROWNS) : rng.pick(GRAYSCALE);
};

// ─── Doors and windows ──────────────────────────────────────────────────────

const placeDoors = (rng: PlanRng, opts: BuildingAttributes, m: Massing, bandPts: Pt2[]): DoorPlan[] => {
  const { doorWidth, doorHeight } = m;
  const doorCount = opts.doorCount ?? (rng() < 0.4 ? 2 : 1);
  /** `offsetOverride`: the door center along the wall axis (rect walls); unset = a seeded spot on the edge. */
  const makeDoor = (edge: number, offsetOverride?: number): DoorPlan => {
    const L = edgeLength(bandPts, edge);
    let t: number;
    if (offsetOverride !== undefined) {
      const a = bandPts[edge];
      const b = bandPts[(edge + 1) % bandPts.length];
      const c: Pt2 =
        edge === RECT_EDGE["+z"] || edge === RECT_EDGE["-z"] ? [offsetOverride, a[1]] : [a[0], offsetOverride];
      t = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? (c[0] - a[0]) / (b[0] - a[0]) : (c[1] - a[1]) / (b[1] - a[1]);
    } else {
      const margin = Math.max(0, (L - doorWidth) / 2 - 0.4);
      t = 0.5 + (rng.range(-1, 1) * margin) / L;
    }
    const c = edgePoint(bandPts, edge, t);
    const n = edgeNormal(bandPts, edge);
    const side: WallSide = Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? "+x" : "-x") : n[1] > 0 ? "+z" : "-z";
    const offset = side === "+z" || side === "-z" ? c[0] : c[1];
    return {
      side,
      offset,
      width: doorWidth,
      height: doorHeight,
      position: [c[0], doorHeight / 2, c[1]],
      yaw: Math.atan2(n[0], n[1]),
      edge,
      t0: t - doorWidth / 2 / L,
      t1: t + doorWidth / 2 / L,
    };
  };

  if (!m.rect) {
    const e0 = rng.rangeInt(0, m.sides - 1);
    const edges = doorCount === 2 ? [e0, (e0 + Math.floor(m.sides / 2)) % m.sides] : [e0];
    return edges.map((e) => makeDoor(e));
  }
  return rng
    .shuffle(SIDES)
    .slice(0, doorCount)
    .map((side) => {
      const wallLen = side === "+z" || side === "-z" ? 2 * m.halfWidth : 2 * m.halfDepth;
      const maxOff = Math.max(0, wallLen / 2 - doorWidth / 2 - 0.8);
      return makeDoor(RECT_EDGE[side], rng.range(-maxOff, maxOff));
    });
};

/** Windows sit in jittered slot cells: never overlapping, never lined up. */
const placeWindows = (
  rng: PlanRng,
  opts: BuildingAttributes,
  lofts: ExteriorLoft[],
  segBounds: SegmentBounds[],
  bandPts: Pt2[],
): BuildingPlan["windows"] => {
  const windows: BuildingPlan["windows"] = [];
  const glass = rng.pick(GLASS_COLORS);
  const windowShapes = opts.windowShapes?.length ? opts.windowShapes : [WINDOW_SHAPE.SQUARE];
  const [winMin, winMax] = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const primaryShape = rng.pick(windowShapes);

  const cells: { loft: number; edge: number; slots: number; k: number; baseY: number; frame: number }[] = [];
  for (const seg of segBounds) {
    const frame = shade(lofts[seg.loft].color, 0.55);
    const segH = seg.y1 - seg.y0;
    if (segH < 6) continue;
    const rows = Math.max(1, Math.floor((segH - 3.4) / WINDOW_ROW_SPACING));
    for (let r = 0; r < rows; r++) {
      const baseY = seg.y0 + 3.0 + r * WINDOW_ROW_SPACING;
      for (let edge = 0; edge < bandPts.length; edge++) {
        const slots = Math.max(1, Math.floor(edgeLength(bandPts, edge) / 4.6));
        for (let k = 0; k < slots; k++) cells.push({ loft: seg.loft, edge, slots, k, baseY, frame });
      }
    }
  }
  const windowTarget = opts.windowCount?.length
    ? clamp(Math.round(rng.pick(opts.windowCount)), 0, cells.length)
    : Math.round(cells.length * rng.range(0.35, 0.55));
  for (const cell of rng.shuffle(cells).slice(0, windowTarget)) {
    const slotW = edgeLength(bandPts, cell.edge) / cell.slots;
    const shape = rng() < 0.75 ? primaryShape : rng.pick(windowShapes);
    const w = Math.min(rng.range(winMin, winMax), slotW * 0.8);
    const h = clamp(w * rng.range(0.65, 1.4), 2.0, 4.6);
    windows.push({
      loft: cell.loft,
      edge: cell.edge,
      edgeParam: (cell.k + rng.range(0.4, 0.6)) / cell.slots,
      y: cell.baseY + rng.range(-0.5, 0.5),
      w,
      h,
      round: shape === WINDOW_SHAPE.CIRCLE,
      skew: shape === WINDOW_SHAPE.CIRCLE ? 0 : rng.range(-0.2, 0.2) * w,
      maxFrac: 0.8 / cell.slots,
      glass,
      frame: cell.frame,
      lightRandom: rng(),
    });
  }
  return windows;
};

// ─── Interior: ramps, rooms, walls ──────────────────────────────────────────

/** Stories generate in order: the gap's ramp first (clear of the arrival rects from below, and of the
 *  exterior door zones on the ground floor), then the BSP around it. A shaft is NOT its own room:
 *  split walls never cross it, so it always lands wholly inside one leaf room. */
const layoutStories = (
  rng: PlanRng,
  m: Massing,
  doors: DoorPlan[],
): { ramps: RampSpec[]; storyLayouts: StoryLayout[] } => {
  const ramps: RampSpec[] = [];
  const storyLayouts: StoryLayout[] = [];
  const doorZones: RoomRect[] = doors.map((d) => ({
    x0: d.position[0] - d.width / 2 - 2.2,
    x1: d.position[0] + d.width / 2 + 2.2,
    z0: d.position[2] - d.width / 2 - 2.2,
    z1: d.position[2] + d.width / 2 + 2.2,
  }));
  let arrival: RoomRect[] = []; // hole + landing of the ramp arriving on this story
  for (let s = 0; s < m.stories; s++) {
    const shaft: RoomRect[] = [];
    if (s < m.stories - 1) {
      const r = placeRamp(rng, m, s, [...arrival, ...(s === 0 ? doorZones : [])]);
      ramps.push(r);
      shaft.push(r.rect);
    }
    storyLayouts.push(buildStoryLayout(rng, m.bsp, m.pickRoomCount(), [...arrival, ...shaft]));
    arrival = s < m.stories - 1 ? [ramps[s].hole, ramps[s].landing] : [];
  }
  return { ramps, storyLayouts };
};

const makeRampAt = (m: Massing, story: number, axis: "x" | "z", dir: 1 | -1, a0: number, l0: number): RampSpec => {
  const a1 = a0 + m.shaftLen;
  const lane1 = l0 + RAMP_WIDTH;
  const runStart = dir === 1 ? a0 + RAMP_LANDING : a1 - RAMP_LANDING;
  const runEnd = runStart + dir * m.rampRun;
  const holeA0 = Math.min(runStart, runEnd);
  const holeA1 = Math.max(runStart, runEnd);
  const landA0 = dir === 1 ? holeA1 : a0;
  const landA1 = dir === 1 ? a1 : holeA0;
  const box = (c0: number, c1: number): RoomRect =>
    axis === "x" ? { x0: c0, z0: l0, x1: c1, z1: lane1 } : { x0: l0, z0: c0, x1: lane1, z1: c1 };
  return {
    story,
    rect: box(a0, a1),
    hole: box(holeA0, holeA1),
    landing: box(landA0, landA1),
    axis,
    dir,
    runStart,
    runEnd,
    lane0: l0,
    lane1,
  };
};

/** A random spot clear of `avoid`; falls back to alternating corners when crowded. */
const placeRamp = (rng: PlanRng, m: Massing, story: number, avoid: RoomRect[]): RampSpec => {
  const { x0: bx0, z0: bz0, x1: bx1, z1: bz1 } = m.bsp;
  const axes: ("x" | "z")[] = [];
  if (bx1 - bx0 >= m.shaftLen + 2 * RAMP_MARGIN) axes.push("x");
  if (bz1 - bz0 >= m.shaftLen + 2 * RAMP_MARGIN) axes.push("z");
  if (axes.length === 0) axes.push("x"); // shaftLen was clamped to the x extent
  for (let attempt = 0; attempt < 40; attempt++) {
    const axis = rng.pick(axes);
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    const [alo, ahi] = axis === "x" ? [bx0, bx1] : [bz0, bz1];
    const [llo, lhi] = axis === "x" ? [bz0, bz1] : [bx0, bx1];
    const r = makeRampAt(
      m,
      story,
      axis,
      dir,
      rng.range(alo + RAMP_MARGIN, ahi - RAMP_MARGIN - m.shaftLen),
      rng.range(llo + RAMP_MARGIN, lhi - RAMP_MARGIN - RAMP_WIDTH),
    );
    if (!avoid.some((o) => rectsOverlap(r.rect, o, 0.5))) return r;
  }
  const corners = [
    makeRampAt(m, story, "x", 1, bx0 + RAMP_MARGIN, bz0 + RAMP_MARGIN),
    makeRampAt(m, story, "x", -1, bx1 - RAMP_MARGIN - m.shaftLen, bz1 - RAMP_MARGIN - RAMP_WIDTH),
  ];
  if (story % 2) corners.reverse();
  return corners.find((r) => !avoid.some((o) => rectsOverlap(r.rect, o, 0.5))) ?? corners[0];
};

const WALL_OBS_MARGIN = WALL_THICKNESS / 2 + 0.25;
const DOOR_CLEARANCE = DOORWAY_WIDTH / 2 + WALL_THICKNESS / 2 + 0.5;
const MIN_SIDE = 3.2;

/** One BSP pass over the story. Each split wall has exactly one doorway, so the room graph is a tree
 *  and every room is reachable. */
const buildStoryLayout = (rng: PlanRng, bsp: RoomRect, targetRooms: number, obstacles: RoomRect[]): StoryLayout => {
  const rooms: RoomRect[] = [{ ...bsp }];
  const splitWalls: SplitWall[] = [];

  const validAt = (axis: "x" | "z", at: number, r: RoomRect): boolean => {
    const [lo, hi, cf, ct] = axis === "x" ? [r.x0, r.x1, r.z0, r.z1] : [r.z0, r.z1, r.x0, r.x1];
    if (at - lo < MIN_SIDE || hi - at < MIN_SIDE) return false;
    for (const o of obstacles) {
      const [oa0, oa1, oc0, oc1] = axis === "x" ? [o.x0, o.x1, o.z0, o.z1] : [o.z0, o.z1, o.x0, o.x1];
      if (at > oa0 - WALL_OBS_MARGIN && at < oa1 + WALL_OBS_MARGIN && cf < oc1 + WALL_OBS_MARGIN && ct > oc0 - WALL_OBS_MARGIN) {
        return false;
      }
    }
    // A wall dead-ending into a perpendicular wall right at its doorway reads as a bug.
    for (const w of splitWalls) {
      if (w.axis === axis) continue;
      const touches = w.at > cf - 0.1 && w.at < ct + 0.1 && at > w.from - 0.1 && at < w.to + 0.1;
      if (touches && Math.abs(at - w.doorAt) < DOOR_CLEARANCE) return false;
    }
    return true;
  };

  /** Avoids opening straight onto a shaft or arrival hole behind the wall. */
  const chooseDoorAt = (axis: "x" | "z", at: number, from: number, to: number): number => {
    if (to - from <= 4.4) return (from + to) / 2;
    let doorAt = rng.range(from + 1.8, to - 1.8);
    for (let k = 0; k < 6; k++) {
      const blocked = obstacles.some((o) => {
        const [oa0, oa1, oc0, oc1] = axis === "x" ? [o.x0, o.x1, o.z0, o.z1] : [o.z0, o.z1, o.x0, o.x1];
        return oa0 - 1.5 < at && oa1 + 1.5 > at && doorAt + DOORWAY_WIDTH / 2 > oc0 - 0.3 && doorAt - DOORWAY_WIDTH / 2 < oc1 + 0.3;
      });
      if (!blocked) break;
      doorAt = rng.range(from + 1.8, to - 1.8);
    }
    return doorAt;
  };

  let guard = targetRooms * 8; // a fully blocked floor stops splitting instead of looping
  while (rooms.length < targetRooms && guard-- > 0) {
    const candidates = rooms
      .map((r, i) => ({ i, w: (r.x1 - r.x0) * (r.z1 - r.z0), r }))
      .filter(({ r }) => Math.max(r.x1 - r.x0, r.z1 - r.z0) >= MIN_ROOM_DIM * 2);
    if (candidates.length === 0) break;
    // Area-weighted pick: big rooms split most often, but not always.
    const totalW = candidates.reduce((a, c) => a + c.w, 0);
    let roll = rng() * totalW;
    let chosen = candidates[candidates.length - 1];
    for (const c of candidates) {
      roll -= c.w;
      if (roll <= 0) {
        chosen = c;
        break;
      }
    }
    const r = chosen.r;
    const rw = r.x1 - r.x0;
    const rd = r.z1 - r.z0;
    let splitX = rw >= rd;
    if (Math.min(rw, rd) >= MIN_ROOM_DIM * 2 && rng() < 0.35) splitX = !splitX;
    const axisOrder: ("x" | "z")[] = [splitX ? "x" : "z"];
    if (Math.min(rw, rd) >= MIN_ROOM_DIM * 2) axisOrder.push(splitX ? "z" : "x");
    for (const axis of axisOrder) {
      const [lo, hi] = axis === "x" ? [r.x0, r.x1] : [r.z0, r.z1];
      let at: number | null = null;
      for (let k = 0; k < 8 && at === null; k++) {
        const cand = lo + (hi - lo) * rng.range(0.35, 0.65);
        if (validAt(axis, cand, r)) at = cand;
      }
      if (at === null) continue;
      if (axis === "x") {
        splitWalls.push({ axis: "x", at, from: r.z0, to: r.z1, doorAt: chooseDoorAt("x", at, r.z0, r.z1) });
        rooms.splice(chosen.i, 1, { ...r, x1: at }, { ...r, x0: at });
      } else {
        splitWalls.push({ axis: "z", at, from: r.x0, to: r.x1, doorAt: chooseDoorAt("z", at, r.x0, r.x1) });
        rooms.splice(chosen.i, 1, { ...r, z1: at }, { ...r, z0: at });
      }
      break;
    }
  }
  return { rooms, splitWalls, obstacles };
};

/** Wall ends on the BSP boundary are stretched to the interior polygon (+0.06 into the cavity), so a
 *  two-room floor is one exterior-to-exterior wall. */
const stretchSplitWallsToShell = (storyLayouts: StoryLayout[], m: Massing): void => {
  for (const layout of storyLayouts) {
    for (const w of layout.splitWalls) {
      const [lo, hi] = ringSpanAt(m.intPts, w.axis, w.at);
      const domLo = w.axis === "x" ? m.bsp.z0 : m.bsp.x0;
      const domHi = w.axis === "x" ? m.bsp.z1 : m.bsp.x1;
      if (w.from <= domLo + 0.05) w.from = lo - 0.06;
      if (w.to >= domHi - 0.05) w.to = hi + 0.06;
    }
  }
};

/** A wall's boxes around its one doorway: the pieces left and right of it, and the lintel above. */
const addWallWithDoor = (boxes: WallBox[], w: SplitWall, ceilingHeight: number): void => {
  const a0 = w.doorAt - DOORWAY_WIDTH / 2;
  const a1 = w.doorAt + DOORWAY_WIDTH / 2;
  const segs: [number, number, number, number][] = []; // [from, to, y0, y1]
  if (a0 - w.from > 0.05) segs.push([w.from, a0, 0, ceilingHeight]);
  if (w.to - a1 > 0.05) segs.push([a1, w.to, 0, ceilingHeight]);
  if (ceilingHeight - DOORWAY_HEIGHT > 0.05) segs.push([Math.max(w.from, a0), Math.min(w.to, a1), DOORWAY_HEIGHT, ceilingHeight]);
  for (const [f, t, y0s, y1s] of segs) {
    if (t - f <= 0.01) continue;
    if (w.axis === "x") {
      boxes.push({ cx: w.at, cy: (y0s + y1s) / 2, cz: (f + t) / 2, sx: WALL_THICKNESS, sy: y1s - y0s, sz: t - f });
    } else {
      boxes.push({ cx: (f + t) / 2, cy: (y0s + y1s) / 2, cz: w.at, sx: t - f, sy: y1s - y0s, sz: WALL_THICKNESS });
    }
  }
};

/** Split walls, plus occasional pillars in big rooms (one landing on a shaft or arrival hole is dropped). */
const buildWallBoxes = (rng: PlanRng, storyLayouts: StoryLayout[], ceilingHeight: number): WallBox[][] =>
  storyLayouts.map((layout) => {
    const boxes: WallBox[] = [];
    for (const w of layout.splitWalls) addWallWithDoor(boxes, w, ceilingHeight);
    for (const r of layout.rooms) {
      const rw = r.x1 - r.x0;
      const rd = r.z1 - r.z0;
      if (rw * rd > 70 && rng() < 0.6) {
        const px = (r.x0 + r.x1) / 2 + rng.range(-0.25, 0.25) * rw;
        const pz = (r.z0 + r.z1) / 2 + rng.range(-0.25, 0.25) * rd;
        if (layout.obstacles.some((o) => px > o.x0 - 0.9 && px < o.x1 + 0.9 && pz > o.z0 - 0.9 && pz < o.z1 + 0.9)) {
          continue;
        }
        boxes.push({ cx: px, cy: ceilingHeight / 2, cz: pz, sx: 0.55, sy: ceilingHeight, sz: 0.55 });
      }
    }
    return boxes;
  });

/** Nudge doors clear of any ground-floor split wall dead-ending into the perimeter, then sync the
 *  position back so the shell carve, the inner carve and the leaf agree. */
const nudgeDoorsClearOfWalls = (doors: DoorPlan[], groundWalls: SplitWall[], intPts: Pt2[], bandPts: Pt2[]): void => {
  for (const d of doors) {
    const len = edgeLength(intPts, d.edge);
    const a = intPts[d.edge];
    const b = intPts[(d.edge + 1) % intPts.length];
    const dirX = (b[0] - a[0]) / len;
    const dirZ = (b[1] - a[1]) / len;
    const tMargin = (d.width / 2 + 0.6) / len;
    let t = clamp((d.t0 + d.t1) / 2, tMargin, 1 - tMargin);
    for (let pass = 0; pass < 2; pass++) {
      for (const w of groundWalls) {
        const ends: [number, number][] =
          w.axis === "x"
            ? [
                [w.at, w.from],
                [w.at, w.to],
              ]
            : [
                [w.from, w.at],
                [w.to, w.at],
              ];
        for (const [ex, ez] of ends) {
          const tE = ((ex - a[0]) * dirX + (ez - a[1]) * dirZ) / len;
          const perp = Math.abs((ex - a[0]) * -dirZ + (ez - a[1]) * dirX);
          if (perp > 0.6 || tE < -0.05 || tE > 1.05) continue;
          if (Math.abs(tE - t) * len < d.width / 2 + WALL_THICKNESS + 0.4) {
            const shift = (d.width / 2 + WALL_THICKNESS + 1) / len;
            t = clamp(tE + (t >= tE ? shift : -shift), tMargin, 1 - tMargin);
          }
        }
      }
    }
    const extLen = edgeLength(bandPts, d.edge);
    const pc = edgePoint(bandPts, d.edge, t);
    d.t0 = t - d.width / 2 / extLen;
    d.t1 = t + d.width / 2 / extLen;
    d.position = [pc[0], d.height / 2, pc[1]];
    d.offset = d.side === "+z" || d.side === "-z" ? pc[0] : pc[1];
  }
};

const placeLightPanels = (rng: PlanRng, m: Massing, ramps: RampSpec[]): [number, number][][] => {
  const lightPanelsPerStory: [number, number][][] = [];
  for (let s = 0; s < m.stories; s++) {
    const holes = ramps.filter((r) => r.story === s).map((r) => r.hole);
    const panels: [number, number][] = [];
    for (let x = -m.interiorHalfWidth + LIGHT_PANEL_SPACING / 2; x < m.interiorHalfWidth - 1; x += LIGHT_PANEL_SPACING) {
      for (let z = -m.interiorHalfDepth + LIGHT_PANEL_SPACING / 2; z < m.interiorHalfDepth - 1; z += LIGHT_PANEL_SPACING) {
        if (!pointInRing(m.intPts, [x, z], 1)) continue;
        if (holes.some((h) => x > h.x0 - 1.6 && x < h.x1 + 1.6 && z > h.z0 - 1.6 && z < h.z1 + 1.6)) continue;
        if (rng() > 0.15) panels.push([x, z]);
      }
    }
    lightPanelsPerStory.push(panels);
  }
  return lightPanelsPerStory;
};

/** Seeded spots for a building's `children`, each in a room and clear of the ramps. */
const placeChildSlots = (rng: PlanRng, m: Massing, storyLayouts: StoryLayout[], ramps: RampSpec[]): ChildSlot[] => {
  const childSlots: ChildSlot[] = [];
  for (let i = 0; i < CHILD_SLOT_COUNT; i++) {
    const story = rng.rangeInt(0, m.stories - 1);
    const storyRooms = storyLayouts[story].rooms;
    const roomIndex = rng.rangeInt(0, storyRooms.length - 1);
    const r = storyRooms[roomIndex];
    const clearOf: RoomRect[] = [
      ...ramps.filter((rp) => rp.story === story).map((rp) => rp.rect),
      ...ramps.filter((rp) => rp.story === story - 1).map((rp) => rp.hole),
    ];
    const wallMargin = 1.4;
    let x = (r.x0 + r.x1) / 2;
    let z = (r.z0 + r.z1) / 2;
    for (let tries = 0; tries < 8; tries++) {
      x = r.x1 - r.x0 > 2 * wallMargin ? rng.range(r.x0 + wallMargin, r.x1 - wallMargin) : (r.x0 + r.x1) / 2;
      z = r.z1 - r.z0 > 2 * wallMargin ? rng.range(r.z0 + wallMargin, r.z1 - wallMargin) : (r.z0 + r.z1) / 2;
      if (!clearOf.some((o) => x > o.x0 - 0.5 && x < o.x1 + 0.5 && z > o.z0 - 0.5 && z < o.z1 + 0.5)) break;
    }
    const y = story * m.storyHeight + (story === 0 ? FLOOR_LIFT : 0);
    childSlots.push({ position: [x, y, z], rotationY: rng.range(0, Math.PI * 2), roomIndex });
  }
  return childSlots;
};
