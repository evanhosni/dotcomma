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

export const WALL_THICKNESS = 0.24;
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


const shade = (hex: number, f: number): number => {
  const r = Math.min(255, Math.round(((hex >> 16) & 0xff) * f));
  const g = Math.min(255, Math.round(((hex >> 8) & 0xff) * f));
  const b = Math.min(255, Math.round((hex & 0xff) * f));
  return (r << 16) | (g << 8) | b;
};

/** Interior-first: rooms × floors size the exterior. Pure and deterministic
 *  (the server generates the same plan for its hull collider). */
export const generateBuildingPlan = (seed: string, opts: BuildingAttributes): BuildingPlan => {
  const rng = seedrandom(`building:${seed}`);
  const range = (a: number, b: number): number => a + rng() * (b - a);
  const rangeInt = (a: number, b: number): number => Math.floor(a + rng() * (b + 1 - a));
  const pick = <T>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  const sideChoices = opts.numberOfSides?.length ? opts.numberOfSides : DEFAULT_SIDES;
  const sides = Math.max(3, Math.round(pick(sideChoices)));
  const rect = sides === 4;
  const phase = rect ? 0 : range(0, Math.PI * 2);

  const ceilingHeight = opts.ceilingHeight ?? 6;
  const storyHeight = ceilingHeight + SLAB_THICKNESS;
  const doorWidth = opts.doorSize?.[0] ?? 2.6;
  const doorHeight = Math.min(opts.doorSize?.[1] ?? 3.2, ceilingHeight - 0.2);
  const doorBandTop = doorHeight + range(0.8, 2);

  let stories = clamp(Math.round(opts.stories ?? rangeInt(1, 5)), 1, 6);
  const requestedStories = stories;
  const roomChoices = (
    Array.isArray(opts.roomCount) ? opts.roomCount : opts.roomCount !== undefined ? [opts.roomCount] : null
  )?.map((n) => Math.max(1, Math.round(n)));
  const pickRoomCount = (): number => (roomChoices?.length ? pick(roomChoices) : rangeInt(3, 6));
  // A floor rolling more rooms than fit just gets a denser split (BSP stops early).
  const maxRoomCount = roomChoices?.length ? Math.max(...roomChoices) : rangeInt(4, 6);
  const roomArea = range(70, 110);
  let rampRun = storyHeight * RAMP_RUN_FACTOR;
  let shaftLen = rampRun + 2 * RAMP_LANDING;
  const shaftWidth = RAMP_WIDTH + WALKWAY_WIDTH;
  // Near-square when multi-story so the inscribed room block fits the shaft.
  let aspect = stories > 1 ? range(0.92, 1.08) : range(0.8, 1.25);

  const SHELL_INSET = 0.24;

  let interiorHalfWidth: number; // interior perimeter half-extents
  let interiorHalfDepth: number;
  let halfWidth = 0; // exterior half-extents at ground level
  let halfDepth = 0;
  if (opts.exteriorSize) {
    halfWidth = opts.exteriorSize[0] / 2;
    halfDepth = opts.exteriorSize[2] / 2;
    interiorHalfWidth = Math.max(4, halfWidth - SHELL_INSET);
    interiorHalfDepth = Math.max(4, halfDepth - SHELL_INSET);
    aspect = interiorHalfDepth / interiorHalfWidth;
  } else {
    const needed = maxRoomCount * roomArea + (stories > 1 ? shaftLen * shaftWidth * 1.4 : 0);
    const unitPts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, halfWidth: 1, halfDepth: aspect }, phase);
    const f = rect ? 1 : inscribedRectFactor(unitPts, 1, aspect);
    const s = Math.sqrt(needed / (4 * f * f * aspect));
    interiorHalfWidth = s;
    interiorHalfDepth = s * aspect;
    // Capped so shells never intersect at the spawn spacing.
    const maxHalf = Math.max(interiorHalfWidth, interiorHalfDepth);
    if (maxHalf > 13) {
      interiorHalfWidth *= 13 / maxHalf;
      interiorHalfDepth *= 13 / maxHalf;
    }
  }

  // The BSP domain is only room BOOKKEEPING: split walls are later stretched
  // past it to the shell's inner surface (no enclosed room-within-a-room).
  const computeBlock = () => {
    const pts = ringPoints(rect, sides, { y: 0, cx: 0, cz: 0, halfWidth: interiorHalfWidth, halfDepth: interiorHalfDepth }, phase);
    const f2 = rect ? 1 : inscribedRectFactor(pts, interiorHalfWidth, interiorHalfDepth, 0.4);
    return {
      pts,
      halfW: Math.max(4, f2 * interiorHalfWidth),
      halfD: Math.max(4, f2 * interiorHalfDepth),
    };
  };
  let block = computeBlock();
  if (stories > 1 && !opts.exteriorSize) {
    const needHalfW = (storyHeight * RAMP_RUN_MIN_FACTOR + 2 * RAMP_LANDING + 2.6) / 2;
    const needHalfD = (shaftWidth + 4) / 2;
    for (let i = 0; i < 6 && (block.halfW < needHalfW || block.halfD < needHalfD) && Math.max(interiorHalfWidth, interiorHalfDepth) < 16; i++) {
      interiorHalfWidth = Math.min(16, interiorHalfWidth * 1.1);
      interiorHalfDepth = Math.min(16, interiorHalfDepth * 1.1);
      block = computeBlock();
    }
  }
  const intPts = block.pts;
  const bspHalfW = block.halfW;
  const bspHalfD = block.halfD;
  const bx0 = -bspHalfW;
  const bz0 = -bspHalfD;
  const bx1 = bspHalfW;
  const bz1 = bspHalfD;

  // Prefer the ≈34° run, steepen to ≈39°, and only as a last resort give up on stories.
  if (stories > 1) {
    const maxShaftLen = bx1 - bx0 - 2.5;
    if (shaftLen > maxShaftLen) {
      rampRun = maxShaftLen - 2 * RAMP_LANDING;
      shaftLen = maxShaftLen;
    }
    if (rampRun < storyHeight * RAMP_RUN_MIN_FACTOR || bz1 - bz0 < shaftWidth + 4) stories = 1;
  }

  if (!opts.exteriorSize) {
    halfWidth = interiorHalfWidth + SHELL_INSET;
    halfDepth = interiorHalfDepth + SHELL_INSET;
  }

  // shellHeightRange only applies when the floors it advertises actually exist.
  let shellHeight: number;
  if (opts.exteriorSize) {
    shellHeight = opts.exteriorSize[1];
  } else if (opts.shellHeightRange && stories === requestedStories) {
    shellHeight = Math.max(range(opts.shellHeightRange[0], opts.shellHeightRange[1]), stories * storyHeight + 2);
  } else if (stories === 1) {
    shellHeight = storyHeight + range(3, 16);
  } else {
    // Even the shortest 2-story shell clears the tallest 1-story one, and a
    // shell of height H never suggests FEWER floors than it has (~30u ⇒ 2, ~48u ⇒ 3, ~60u ⇒ 4).
    shellHeight = stories * storyHeight + range(8, 12) + stories * (stories <= 2 ? range(2.5, 4.5) : range(5, 7));
  }

  // Rings up to interiorTop are clamped to wrap the interior prism; above it the shell leans/tapers freely.
  const interiorTop = stories * storyHeight + 0.5;
  const leanAngle = range(0, Math.PI * 2);
  const leanMag = range(0, opts.maxLean ?? 0.08) * shellHeight;
  const leanExp = range(1.2, 1.9);
  const topScale = range(0.7, 1.25);
  // Polygon faces sit at apothem distance (over-provision by 1/cos(π/N)); the
  // FULL lean is charged to both axes, since per-axis components under-cover diagonals.
  const apothem = rect ? 1 : Math.cos(Math.PI / sides);
  const clampMargin = (lean: number): number => (0.9 + lean) / apothem;
  const ringAt = (y: number, rScale: number): RingLevel => {
    const t = clamp((y - doorBandTop) / Math.max(shellHeight - doorBandTop, 1e-6), 0, 1);
    const lean = leanMag * Math.pow(t, leanExp);
    const g = 1 + (topScale - 1) * Math.pow(t, 1.15);
    const cx = Math.cos(leanAngle) * lean;
    const cz = Math.sin(leanAngle) * lean;
    let ringHalfWidth = halfWidth * g * rScale;
    let ringHalfDepth = halfDepth * g * rScale;
    if (y <= interiorTop) {
      const m = clampMargin(lean);
      ringHalfWidth = Math.max(ringHalfWidth, interiorHalfWidth + m);
      ringHalfDepth = Math.max(ringHalfDepth, interiorHalfDepth + m);
    }
    return { y, cx, cz, halfWidth: ringHalfWidth, halfDepth: ringHalfDepth };
  };

  const palette = opts.palette?.length ? opts.palette : GRAYSCALE;
  const accents = opts.accentColors?.length ? opts.accentColors : ACCENTS;
  const accentChance = opts.accentChance ?? 0.2;
  const primary = rng() < accentChance ? pick(accents) : pick(palette);
  const segColor = (): number => (rng() < 0.55 ? primary : rng() < accentChance * 0.4 ? pick(accents) : pick(palette));

  // Door band: the prismatic ground section the doors are carved into.
  const bandColor = segColor();
  const bandBot: RingLevel = { y: -FOUNDATION_DEPTH, cx: 0, cz: 0, halfWidth, halfDepth };
  const bandTop: RingLevel = { ...bandBot, y: doorBandTop };
  const lofts: ExteriorLoft[] = [{ rect, sides, ringRotation: phase, levels: [bandBot, bandTop], color: bandColor, hasRoofFan: false }];

  const interiorWall = opts.interiorColors?.wall ?? bandColor;
  const interiorColors = {
    wall: interiorWall,
    floor: opts.interiorColors?.floor ?? shade(interiorWall, 0.65),
    ceiling: opts.interiorColors?.ceiling ?? shade(interiorWall, 1.3),
    ramp: opts.interiorColors?.ramp ?? shade(interiorWall, 0.8),
  };

  const segCount = rangeInt(2, 4);
  const weights = Array.from({ length: segCount }, () => range(0.6, 1.6));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const segBounds: { loft: number; y0: number; y1: number }[] = [];
  let y0 = doorBandTop;
  let prevTop = bandTop;
  for (let k = 0; k < segCount; k++) {
    const y1 = k === segCount - 1 ? shellHeight : y0 + ((shellHeight - doorBandTop) * weights[k]) / weightSum;
    const rScale = range(0.9, 1.1);
    const levels: RingLevel[] = [
      { ...prevTop }, // continuity with the mass below; the lip step is the next level
      ringAt(y0 + 0.06, rScale * range(1.0, 1.07)),
      ringAt((y0 + y1) / 2, rScale * range(0.97, 1.1)),
      ringAt(y1, rScale * range(0.92, 1.02)),
    ];
    // ringAt clamps only AT levels: a wall lerping from a clamped ring to a
    // tapered one above interiorTop would slice the interior's top corner.
    for (let i = 0; i < levels.length - 1; i++) {
      const A = levels[i];
      const B = levels[i + 1];
      if (A.y < interiorTop && B.y > interiorTop) {
        const t = (interiorTop - A.y) / (B.y - A.y);
        const cx = A.cx + (B.cx - A.cx) * t;
        const cz = A.cz + (B.cz - A.cz) * t;
        const m = clampMargin(Math.hypot(cx, cz));
        levels.splice(i + 1, 0, {
          y: interiorTop,
          cx,
          cz,
          halfWidth: Math.max(A.halfWidth + (B.halfWidth - A.halfWidth) * t, interiorHalfWidth + m),
          halfDepth: Math.max(A.halfDepth + (B.halfDepth - A.halfDepth) * t, interiorHalfDepth + m),
        });
        break;
      }
    }
    lofts.push({ rect, sides, ringRotation: phase, levels, color: segColor(), hasRoofFan: k === segCount - 1 });
    segBounds.push({ loft: lofts.length - 1, y0, y1 });
    prevTop = levels[levels.length - 1];
    y0 = y1;
  }

  /** Pulls a roof decoration inward just until its base sits on the roof polygon (clamps, never re-centers). */
  const fitOnRoof = (
    roof: RingLevel,
    x: number,
    z: number,
    basePts: (x: number, z: number) => Pt2[],
  ): [number, number] => {
    const roofPts = ringPoints(rect, sides, roof, phase);
    for (let i = 0; i < 6; i++) {
      if (basePts(x, z).every((p) => pointInRing(roofPts, p, 0.05))) return [x, z];
      x = roof.cx + (x - roof.cx) * 0.6;
      z = roof.cz + (z - roof.cz) * 0.6;
    }
    return [roof.cx, roof.cz];
  };

  let capBase = prevTop;
  const capCount = rangeInt(0, 2);
  for (let i = 0; i < capCount; i++) {
    const cw = capBase.halfWidth * range(0.3, 0.55);
    const cd = capBase.halfDepth * range(0.3, 0.55);
    const chh = range(1.5, 4) * (i === 0 ? 1.3 : 0.8);
    const [ccx, ccz] = fitOnRoof(
      capBase,
      capBase.cx + range(-1, 1) * (capBase.halfWidth - cw) * 0.5,
      capBase.cz + range(-1, 1) * (capBase.halfDepth - cd) * 0.5,
      (x, z) => ringPoints(rect, sides, { y: 0, cx: x, cz: z, halfWidth: cw, halfDepth: cd }, phase),
    );
    const top: RingLevel = { y: capBase.y + chh, cx: ccx, cz: ccz, halfWidth: cw * range(0.8, 1), halfDepth: cd * range(0.8, 1) };
    lofts.push({
      rect,
      sides,
      ringRotation: phase,
      levels: [{ y: capBase.y, cx: ccx, cz: ccz, halfWidth: cw, halfDepth: cd }, top],
      color: segColor(),
      hasRoofFan: true,
    });
    capBase = top;
  }

  const pipeCount = rangeInt(0, 2);
  for (let p = 0; p < pipeCount; p++) {
    const pr = range(0.25, 0.5);
    const [px, pz] = fitOnRoof(
      capBase,
      capBase.cx + range(-1, 1) * Math.max(0, capBase.halfWidth - pr - 0.2),
      capBase.cz + range(-1, 1) * Math.max(0, capBase.halfDepth - pr - 0.2),
      (x, z) => ringPoints(false, 8, { y: 0, cx: x, cz: z, halfWidth: pr, halfDepth: pr }, 0),
    );
    const bend = range(0, Math.PI * 2);
    const y1 = capBase.y + range(0.8, 2);
    const y2 = y1 + range(0.5, 1.1);
    const reach = range(0.5, 1.3);
    const levels: RingLevel[] = [
      { y: capBase.y - 0.2, cx: px, cz: pz, halfWidth: pr, halfDepth: pr },
      { y: y1, cx: px, cz: pz, halfWidth: pr, halfDepth: pr },
      { y: y2, cx: px + Math.cos(bend) * reach, cz: pz + Math.sin(bend) * reach, halfWidth: pr, halfDepth: pr },
    ];
    if (rng() < 0.5) {
      levels.push({
        y: y2 + range(0.4, 1),
        cx: px + Math.cos(bend) * reach * 1.6,
        cz: pz + Math.sin(bend) * reach * 1.6,
        halfWidth: pr,
        halfDepth: pr,
      });
    }
    lofts.push({ rect: false, sides: 8, ringRotation: 0, levels, color: pick(PIPE_COLORS), hasRoofFan: true });
  }

  // Doors never introduce a new bright hue.
  const doorRoll = rng();
  const doorColor =
    doorRoll < 0.4 ? pick(lofts.map((l) => l.color)) : doorRoll < 0.7 ? pick(DOOR_BROWNS) : pick(GRAYSCALE);

  const doorCount = opts.doorCount ?? (rng() < 0.4 ? 2 : 1);
  const bandPts = ringPoints(rect, sides, bandTop, phase);
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
      t = 0.5 + (range(-1, 1) * margin) / L;
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

  let doors: DoorPlan[];
  if (!rect) {
    const e0 = rangeInt(0, sides - 1);
    const edges = doorCount === 2 ? [e0, (e0 + Math.floor(sides / 2)) % sides] : [e0];
    doors = edges.map((e) => makeDoor(e));
  } else {
    doors = shuffle(SIDES)
      .slice(0, doorCount)
      .map((side) => {
        const wallLen = side === "+z" || side === "-z" ? 2 * halfWidth : 2 * halfDepth;
        const maxOff = Math.max(0, wallLen / 2 - doorWidth / 2 - 0.8);
        return makeDoor(RECT_EDGE[side], range(-maxOff, maxOff));
      });
  }

  // Windows sit in jittered slot cells: never overlapping, never lined up.
  const windows: BuildingPlan["windows"] = [];
  const windowLightChance = clamp(opts.windowLightChance ?? 0.6, 0, 1);
  const windowLightIntensity = Math.max(0, opts.windowLightIntensity ?? 1.4);
  const glass = pick(GLASS_COLORS);
  const windowShapes = opts.windowShapes?.length ? opts.windowShapes : [WINDOW_SHAPE.SQUARE];
  const [winMin, winMax] = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const primaryShape = pick(windowShapes);

  interface WindowCell {
    loft: number;
    edge: number;
    slots: number;
    k: number;
    baseY: number;
    frame: number;
  }
  const cells: WindowCell[] = [];
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
    ? clamp(Math.round(pick(opts.windowCount)), 0, cells.length)
    : Math.round(cells.length * range(0.35, 0.55));
  for (const cell of shuffle(cells).slice(0, windowTarget)) {
    const slotW = edgeLength(bandPts, cell.edge) / cell.slots;
    const shape = rng() < 0.75 ? primaryShape : pick(windowShapes);
    const w = Math.min(range(winMin, winMax), slotW * 0.8);
    const h = clamp(w * range(0.65, 1.4), 2.0, 4.6);
    windows.push({
      loft: cell.loft,
      edge: cell.edge,
      edgeParam: (cell.k + range(0.4, 0.6)) / cell.slots,
      y: cell.baseY + range(-0.5, 0.5),
      w,
      h,
      round: shape === WINDOW_SHAPE.CIRCLE,
      skew: shape === WINDOW_SHAPE.CIRCLE ? 0 : range(-0.2, 0.2) * w,
      maxFrac: 0.8 / cell.slots,
      glass,
      frame: cell.frame,
      lightRandom: rng(),
    });
  }

  // A shaft is NOT its own room: split walls never cross it, so it always
  // lands wholly inside one leaf room.
  const rectsOverlap = (a: RoomRect, b: RoomRect, m: number): boolean =>
    a.x0 < b.x1 + m && a.x1 > b.x0 - m && a.z0 < b.z1 + m && a.z1 > b.z0 - m;

  const makeRampAt = (story: number, axis: "x" | "z", dir: 1 | -1, a0: number, l0: number): RampSpec => {
    const a1 = a0 + shaftLen;
    const lane1 = l0 + RAMP_WIDTH;
    const runStart = dir === 1 ? a0 + RAMP_LANDING : a1 - RAMP_LANDING;
    const runEnd = runStart + dir * rampRun;
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

  /** Falls back to alternating corners when crowded. */
  const placeRamp = (story: number, avoid: RoomRect[]): RampSpec => {
    const axes: ("x" | "z")[] = [];
    if (bx1 - bx0 >= shaftLen + 2 * RAMP_MARGIN) axes.push("x");
    if (bz1 - bz0 >= shaftLen + 2 * RAMP_MARGIN) axes.push("z");
    if (axes.length === 0) axes.push("x"); // shaftLen was clamped to the x extent
    for (let attempt = 0; attempt < 40; attempt++) {
      const axis = pick(axes);
      const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const [alo, ahi] = axis === "x" ? [bx0, bx1] : [bz0, bz1];
      const [llo, lhi] = axis === "x" ? [bz0, bz1] : [bx0, bx1];
      const r = makeRampAt(
        story,
        axis,
        dir,
        range(alo + RAMP_MARGIN, ahi - RAMP_MARGIN - shaftLen),
        range(llo + RAMP_MARGIN, lhi - RAMP_MARGIN - RAMP_WIDTH),
      );
      if (!avoid.some((o) => rectsOverlap(r.rect, o, 0.5))) return r;
    }
    const corners = [
      makeRampAt(story, "x", 1, bx0 + RAMP_MARGIN, bz0 + RAMP_MARGIN),
      makeRampAt(story, "x", -1, bx1 - RAMP_MARGIN - shaftLen, bz1 - RAMP_MARGIN - RAMP_WIDTH),
    ];
    if (story % 2) corners.reverse();
    return corners.find((r) => !avoid.some((o) => rectsOverlap(r.rect, o, 0.5))) ?? corners[0];
  };

  // One BSP pass per story. Each split wall has exactly one doorway, so the
  // room graph is a tree and every room is reachable.
  interface StoryLayout {
    rooms: RoomRect[];
    splitWalls: SplitWall[];
    obstacles: RoomRect[];
  }
  const WALL_OBS_MARGIN = WALL_THICKNESS / 2 + 0.25;
  const DOOR_CLEARANCE = DOORWAY_WIDTH / 2 + WALL_THICKNESS / 2 + 0.5;
  const MIN_SIDE = 3.2;

  const buildStoryLayout = (targetRooms: number, obstacles: RoomRect[]): StoryLayout => {
    const rooms: RoomRect[] = [{ x0: bx0, z0: bz0, x1: bx1, z1: bz1 }];
    const splitWalls: SplitWall[] = [];

    const validAt = (axis: "x" | "z", at: number, r: RoomRect): boolean => {
      const [lo, hi, cf, ct] = axis === "x" ? [r.x0, r.x1, r.z0, r.z1] : [r.z0, r.z1, r.x0, r.x1];
      if (at - lo < MIN_SIDE || hi - at < MIN_SIDE) return false;
      for (const o of obstacles) {
        const [oa0, oa1, oc0, oc1] = axis === "x" ? [o.x0, o.x1, o.z0, o.z1] : [o.z0, o.z1, o.x0, o.x1];
        if (
          at > oa0 - WALL_OBS_MARGIN &&
          at < oa1 + WALL_OBS_MARGIN &&
          cf < oc1 + WALL_OBS_MARGIN &&
          ct > oc0 - WALL_OBS_MARGIN
        ) {
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
      let doorAt = range(from + 1.8, to - 1.8);
      for (let k = 0; k < 6; k++) {
        const blocked = obstacles.some((o) => {
          const [oa0, oa1, oc0, oc1] = axis === "x" ? [o.x0, o.x1, o.z0, o.z1] : [o.z0, o.z1, o.x0, o.x1];
          return (
            oa0 - 1.5 < at &&
            oa1 + 1.5 > at &&
            doorAt + DOORWAY_WIDTH / 2 > oc0 - 0.3 &&
            doorAt - DOORWAY_WIDTH / 2 < oc1 + 0.3
          );
        });
        if (!blocked) break;
        doorAt = range(from + 1.8, to - 1.8);
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
          const cand = lo + (hi - lo) * range(0.35, 0.65);
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

  // Stories generate in order: the gap's ramp first (clear of the arrival
  // rects from below), then the BSP around it.
  const ramps: RampSpec[] = [];
  const storyLayouts: StoryLayout[] = [];
  const doorZones: RoomRect[] = doors.map((d) => ({
    x0: d.position[0] - d.width / 2 - 2.2,
    x1: d.position[0] + d.width / 2 + 2.2,
    z0: d.position[2] - d.width / 2 - 2.2,
    z1: d.position[2] + d.width / 2 + 2.2,
  }));
  let arrival: RoomRect[] = []; // hole + landing of the ramp arriving on this story
  for (let s = 0; s < stories; s++) {
    const shaft: RoomRect[] = [];
    if (s < stories - 1) {
      const r = placeRamp(s, [...arrival, ...(s === 0 ? doorZones : [])]);
      ramps.push(r);
      shaft.push(r.rect);
    }
    storyLayouts.push(buildStoryLayout(pickRoomCount(), [...arrival, ...shaft]));
    arrival = s < stories - 1 ? [ramps[s].hole, ramps[s].landing] : [];
  }


  const addWallWithDoor = (
    boxes: WallBox[],
    axis: "x" | "z",
    at: number,
    from: number,
    to: number,
    doorAt: number,
    dw: number,
    dh: number,
  ): void => {
    const a0 = doorAt - dw / 2;
    const a1 = doorAt + dw / 2;
    const segs: [number, number, number, number][] = []; // [from, to, y0, y1]
    if (a0 - from > 0.05) segs.push([from, a0, 0, ceilingHeight]);
    if (to - a1 > 0.05) segs.push([a1, to, 0, ceilingHeight]);
    if (ceilingHeight - dh > 0.05) segs.push([Math.max(from, a0), Math.min(to, a1), dh, ceilingHeight]);
    for (const [f, t, y0s, y1s] of segs) {
      if (t - f <= 0.01) continue;
      if (axis === "x") {
        boxes.push({ cx: at, cy: (y0s + y1s) / 2, cz: (f + t) / 2, sx: WALL_THICKNESS, sy: y1s - y0s, sz: t - f });
      } else {
        boxes.push({ cx: (f + t) / 2, cy: (y0s + y1s) / 2, cz: at, sx: t - f, sy: y1s - y0s, sz: WALL_THICKNESS });
      }
    }
  };

  // Wall ends on the BSP boundary are stretched to the interior polygon
  // (+0.06 into the cavity) so a two-room floor is one exterior-to-exterior wall.
  for (const layout of storyLayouts) {
    for (const w of layout.splitWalls) {
      const [lo, hi] = ringSpanAt(intPts, w.axis, w.at);
      const domLo = w.axis === "x" ? bz0 : bx0;
      const domHi = w.axis === "x" ? bz1 : bx1;
      if (w.from <= domLo + 0.05) w.from = lo - 0.06;
      if (w.to >= domHi - 0.05) w.to = hi + 0.06;
    }
  }

  const wallBoxesPerStory: WallBox[][] = storyLayouts.map((layout) => {
    const boxes: WallBox[] = [];
    for (const w of layout.splitWalls) {
      addWallWithDoor(boxes, w.axis, w.at, w.from, w.to, w.doorAt, DOORWAY_WIDTH, DOORWAY_HEIGHT);
    }
    // Occasional pillars in big rooms; one landing on a shaft or arrival hole is dropped.
    for (const r of layout.rooms) {
      const rw = r.x1 - r.x0;
      const rd = r.z1 - r.z0;
      if (rw * rd > 70 && rng() < 0.6) {
        const px = (r.x0 + r.x1) / 2 + range(-0.25, 0.25) * rw;
        const pz = (r.z0 + r.z1) / 2 + range(-0.25, 0.25) * rd;
        if (layout.obstacles.some((o) => px > o.x0 - 0.9 && px < o.x1 + 0.9 && pz > o.z0 - 0.9 && pz < o.z1 + 0.9)) {
          continue;
        }
        boxes.push({ cx: px, cy: ceilingHeight / 2, cz: pz, sx: 0.55, sy: ceilingHeight, sz: 0.55 });
      }
    }
    return boxes;
  });

  // Nudge doors clear of any ground-floor split wall dead-ending into the
  // perimeter, then sync the position back so shell carve, inner carve and leaf agree.
  const groundWalls = storyLayouts[0].splitWalls;
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

  const lightPanelsPerStory: [number, number][][] = [];
  for (let s = 0; s < stories; s++) {
    const holes = ramps.filter((r) => r.story === s).map((r) => r.hole);
    const panels: [number, number][] = [];
    for (let x = -interiorHalfWidth + LIGHT_PANEL_SPACING / 2; x < interiorHalfWidth - 1; x += LIGHT_PANEL_SPACING) {
      for (let z = -interiorHalfDepth + LIGHT_PANEL_SPACING / 2; z < interiorHalfDepth - 1; z += LIGHT_PANEL_SPACING) {
        if (!pointInRing(intPts, [x, z], 1)) continue;
        if (holes.some((h) => x > h.x0 - 1.6 && x < h.x1 + 1.6 && z > h.z0 - 1.6 && z < h.z1 + 1.6)) continue;
        if (rng() > 0.15) panels.push([x, z]);
      }
    }
    lightPanelsPerStory.push(panels);
  }

  const childSlots: ChildSlot[] = [];
  for (let i = 0; i < CHILD_SLOT_COUNT; i++) {
    const story = rangeInt(0, stories - 1);
    const storyRooms = storyLayouts[story].rooms;
    const roomIndex = rangeInt(0, storyRooms.length - 1);
    const r = storyRooms[roomIndex];
    const clearOf: RoomRect[] = [
      ...ramps.filter((rp) => rp.story === story).map((rp) => rp.rect),
      ...ramps.filter((rp) => rp.story === story - 1).map((rp) => rp.hole),
    ];
    const m = 1.4;
    let x = (r.x0 + r.x1) / 2;
    let z = (r.z0 + r.z1) / 2;
    for (let tries = 0; tries < 8; tries++) {
      x = r.x1 - r.x0 > 2 * m ? range(r.x0 + m, r.x1 - m) : (r.x0 + r.x1) / 2;
      z = r.z1 - r.z0 > 2 * m ? range(r.z0 + m, r.z1 - m) : (r.z0 + r.z1) / 2;
      if (!clearOf.some((o) => x > o.x0 - 0.5 && x < o.x1 + 0.5 && z > o.z0 - 0.5 && z < o.z1 + 0.5)) break;
    }
    const y = story * storyHeight + (story === 0 ? FLOOR_LIFT : 0);
    childSlots.push({ position: [x, y, z], rotationY: range(0, Math.PI * 2), roomIndex });
  }

  return {
    seed,
    footprint: [2 * halfWidth, 2 * halfDepth],
    height: shellHeight,
    doorBandTop,
    foundationDepth: FOUNDATION_DEPTH,
    lofts,
    bodyLoftCount: 1 + segCount,
    doors,
    doorColor,
    windowLightChance,
    windowLightIntensity,
    windows,
    interior: {
      width: 2 * interiorHalfWidth,
      depth: 2 * interiorHalfDepth,
      ceilingHeight,
      colors: interiorColors,
      stories,
      storyHeight,
      roomsPerStory: storyLayouts.map((l) => l.rooms),
      wallBoxesPerStory,
      ramps,
      lightPanelsPerStory,
      childSlots,
    },
  };
};
