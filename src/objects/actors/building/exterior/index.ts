import { clamp } from "../../../../utils/math";
import { edgeLength, edgeNormal, edgePoint, hipRoofRings, offsetRing, pointInRing, RECT_EDGE, ringPoints, luminanceOf, mixToWhite, shade } from "../utils";
import { Pt2, BuildingAttributes, BuildingPlan, DoorPlan, ExteriorLoft, RingLevel, WallSide, WindowSpec } from "../types";
import { WINDOW_SHAPE } from "../enums";
import type { PlanRng, Massing } from "../types";
import type { ShellRingAt, SegmentBounds } from "./types";
import { GRAYSCALE, ACCENTS, ROOF_SHINGLES, PIPE_COLORS, DOOR_CONTRAST, DOOR_BROWNS, HANDLE_METALS, SIDES, GLASS_COLORS, DEFAULT_WINDOW_SIZE, WINDOW_ROW_SPACING } from "./constants";
import { FOUNDATION_DEPTH, FLOOR_LIFT } from "../constants";

export const createShellRings = (rng: PlanRng, opts: BuildingAttributes, m: Massing, shellHeight: number): ShellRingAt => {
  const interiorTop = m.stories * m.storyHeight + 0.5;
  const leanAngle = rng.range(0, Math.PI * 2);
  const leanMag = m.pitched ? 0 : rng.range(0, opts.maxLean ?? 0.08) * shellHeight;
  const leanExp = rng.range(1.2, 1.9);
  const topScale = m.pitched ? 1 : rng.range(0.7, 1.25);
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

/** The primary color is rolled once; each segment mostly repeats it (`uniform`: always). */
export const createSegmentColors = (rng: PlanRng, opts: BuildingAttributes, uniform: boolean): (() => number) => {
  const palette = opts.palette?.length ? opts.palette : GRAYSCALE;
  const accents = opts.accentColors?.length ? opts.accentColors : ACCENTS;
  const accentChance = opts.accentChance ?? 0.2;
  const primary = rng() < accentChance ? rng.pick(accents) : rng.pick(palette);
  if (uniform) return () => primary;
  return () => (rng() < 0.55 ? primary : rng() < accentChance * 0.4 ? rng.pick(accents) : rng.pick(palette));
};

export const buildLofts = (
  rng: PlanRng,
  opts: BuildingAttributes,
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

  if (m.pitched) {
    // The band's own ring continued up: it already wraps the interior, and ringAt's lean clearance
    // would step the wall out into a ledge above the doors.
    const wallTop: RingLevel = { ...bandTop, y: shellHeight };
    lofts.push({ rect, sides, ringRotation, levels: [{ ...bandTop }, wallTop], color: segmentColor(), hasRoofFan: false });
    addHipRoof(rng, opts, m, lofts, wallTop);
    return { lofts, bandTop, bandColor, segBounds: [{ loft: 1, y0: m.doorBandTop, y1: shellHeight }] };
  }

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

/** An overhanging hip roof: a soffit out to the eave, a fascia, then every face at ONE pitch up the
 *  eave's straight skeleton (hipRoofRings) — a ridge on a rectangle, a peak over a triangle's incenter.
 *  Not a body loft, so the proxy hull ignores it. */
const addHipRoof = (rng: PlanRng, opts: BuildingAttributes, m: Massing, lofts: ExteriorLoft[], wallTop: RingLevel): void => {
  const wallPts = ringPoints(m.rect, m.sides, wallTop, m.ringRotation);
  const eavePts = offsetRing(wallPts, -rng.range(0.6, 1.2));
  const fasciaY = wallTop.y + 0.35;
  const slope = Math.tan(rng.range(0.55, 0.8)); // ≈32–46°
  const skeleton = hipRoofRings(eavePts);
  const roofColors = opts.roofColors?.length ? opts.roofColors : ROOF_SHINGLES;
  lofts.push({
    rect: m.rect,
    sides: m.sides,
    ringRotation: m.ringRotation,
    levels: [wallTop.y, wallTop.y, fasciaY, ...skeleton.offsets.slice(1).map((d) => fasciaY + d * slope)].map((y) => ({ ...wallTop, y })),
    points: [wallPts, eavePts, eavePts, ...skeleton.rings.slice(1)],
    color: rng.pick(roofColors),
    hasRoofFan: false,
  });
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

/** Moves the door's luminance at least DOOR_CONTRAST away from every wall it is seen against: lighter
 *  when there is room above them, else darker. Hue differences alone vanish at night. */
const contrastDoor = (door: number, walls: number[]): number => {
  const lums = walls.map(luminanceOf);
  const lum = luminanceOf(door);
  if (lums.every((w) => Math.abs(lum - w) >= DOOR_CONTRAST)) return door;
  const lighter = Math.max(...lums) + DOOR_CONTRAST;
  const darker = Math.min(...lums) - DOOR_CONTRAST;
  if (lighter <= 0.92 && (darker < 0.04 || lighter - lum <= lum - darker)) {
    return lum < lighter ? mixToWhite(door, (lighter - lum) / (1 - lum)) : door;
  }
  return lum > 0.01 ? shade(door, Math.max(0, darker) / lum) : door;
};

/** Doors never introduce a new bright hue, and always stand out from the band they sit in (outside) and
 *  the interior wall (inside). */
export const chooseDoorLook = (
  rng: PlanRng,
  lofts: ExteriorLoft[],
  bandColor: number,
  interiorWall: number,
): Pick<BuildingPlan, "doorColor" | "doorHandle"> => {
  const doorRoll = rng();
  const otherLoftColors = lofts.map((l) => l.color).filter((c) => c !== bandColor);
  const picked =
    doorRoll < 0.4
      ? rng.pick(otherLoftColors.length ? otherLoftColors : [bandColor])
      : doorRoll < 0.7
        ? rng.pick(DOOR_BROWNS)
        : rng.pick(GRAYSCALE);
  const doorColor = contrastDoor(picked, [bandColor, interiorWall]);
  return { doorColor, doorHandle: { lever: rng() < 0.5, color: rng.pick(HANDLE_METALS) } };
};

// ─── Doors and windows ──────────────────────────────────────────────────────

export const placeDoors = (rng: PlanRng, opts: BuildingAttributes, m: Massing, bandPts: Pt2[]): DoorPlan[] => {
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
export const placeWindows = (
  rng: PlanRng,
  opts: BuildingAttributes,
  m: Massing,
  lofts: ExteriorLoft[],
  segBounds: SegmentBounds[],
  bandPts: Pt2[],
  shellHeight: number,
): WindowSpec[] => {
  const windows: WindowSpec[] = [];
  const glass = rng.pick(GLASS_COLORS);
  const windowShapes = opts.windowShapes?.length ? opts.windowShapes : [WINDOW_SHAPE.SQUARE];
  const [winMin, winMax] = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const primaryShape = rng.pick(windowShapes);

  // A house's straight walls are one surface: a row per story, ground floor included (the doors are
  // kept clear afterwards, windowOverlapsDoor), each in whichever loft holds its center.
  const rows: { loft: number; baseY: number }[] = [];
  if (m.pitched) {
    for (let s = 0; s < m.stories; s++) {
      const baseY = s * m.storyHeight + FLOOR_LIFT + m.ceilingHeight * 0.5;
      if (baseY + 1.2 < shellHeight) rows.push({ loft: baseY < m.doorBandTop ? 0 : 1, baseY });
    }
  } else {
    for (const seg of segBounds) {
      const segH = seg.y1 - seg.y0;
      if (segH < 6) continue;
      const rowCount = Math.max(1, Math.floor((segH - 3.4) / WINDOW_ROW_SPACING));
      for (let r = 0; r < rowCount; r++) rows.push({ loft: seg.loft, baseY: seg.y0 + 3.0 + r * WINDOW_ROW_SPACING });
    }
  }
  const cells: { loft: number; edge: number; slots: number; k: number; baseY: number; frame: number }[] = [];
  for (const { loft, baseY } of rows) {
    const frame = shade(lofts[loft].color, 0.55);
    for (let edge = 0; edge < bandPts.length; edge++) {
      const slots = Math.max(1, Math.floor(edgeLength(bandPts, edge) / 4.6));
      for (let k = 0; k < slots; k++) cells.push({ loft, edge, slots, k, baseY, frame });
    }
  }
  const [fillMin, fillMax] = m.pitched ? [0.5, 0.75] : [0.35, 0.55];
  const windowTarget = opts.windowCount?.length
    ? clamp(Math.round(rng.pick(opts.windowCount)), 0, cells.length)
    : Math.round(cells.length * rng.range(fillMin, fillMax));
  // A house window stays inside its story.
  const maxH = m.pitched ? Math.min(4.6, m.ceilingHeight * 0.55) : 4.6;
  for (const cell of rng.shuffle(cells).slice(0, windowTarget)) {
    const slotW = edgeLength(bandPts, cell.edge) / cell.slots;
    const shape = rng() < 0.75 ? primaryShape : rng.pick(windowShapes);
    const w = Math.min(rng.range(winMin, winMax), slotW * 0.8);
    const h = clamp(w * rng.range(0.65, 1.4), Math.min(2.0, maxH), maxH);
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

/** A window reaching down into a door's opening (plus a margin) on the door's facet. Run after the doors'
 *  final nudge, so it sees where they really are. */
export const windowOverlapsDoor = (w: WindowSpec, doors: DoorPlan[], bandPts: Pt2[]): boolean =>
  doors.some((d) => {
    if (d.edge !== w.edge || w.y - w.h / 2 > d.height + 0.4) return false;
    const L = edgeLength(bandPts, d.edge);
    return Math.abs(w.edgeParam - (d.t0 + d.t1) / 2) * L < (w.w + d.width) / 2 + 0.6;
  });
