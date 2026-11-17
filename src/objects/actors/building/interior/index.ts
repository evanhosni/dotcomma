import { clamp } from "../../../../utils/math";
import { edgeLength, edgePoint, pointInRing, ringSpanAt, clampLuminance, shade, rectsOverlap } from "../utils";
import { Pt2, BuildingAttributes, ChildSlot, DoorPlan, RampSpec, RoomRect, WallBox } from "../types";
import { INTERIOR_WALL_LUMINANCE, INTERIOR_LUMINANCE, RAMP_MARGIN, MIN_SIDE, WALL_OBS_MARGIN, DOOR_CLEARANCE, DOORWAY_WIDTH, MIN_ROOM_DIM, WALL_THICKNESS, LIGHT_PANEL_SIZE, LIGHT_PANEL_WALL_CLEARANCE, LIGHT_PANEL_SPACING, DOME_LIGHT_AREA, CHILD_SLOT_COUNT } from "./constants";
import type { PlanRng, Massing } from "../types";
import type { StoryLayout, SplitWall } from "./types";
import { RAMP_WIDTH, RAMP_LANDING, FLOOR_LIFT } from "../constants";

/**
 * BuildingAttributes + a seed → a pure-data BuildingPlan. Interior-first: rooms × floors size the
 * exterior. Pure and deterministic — the server generates the same plan for its hull collider — so
 * every roll goes through ONE seeded stream in a fixed order: reordering any two rolls (or any two
 * phases below) moves every building in the world.
 */

export const interiorColorsOf = (opts: BuildingAttributes, bandColor: number) => {
  const wall = opts.interiorColors?.wall ?? clampLuminance(bandColor, ...INTERIOR_WALL_LUMINANCE);
  const [lo, hi] = INTERIOR_LUMINANCE;
  return {
    wall: clampLuminance(wall, lo, hi),
    floor: clampLuminance(opts.interiorColors?.floor ?? shade(wall, 0.65), lo, hi),
    ceiling: clampLuminance(opts.interiorColors?.ceiling ?? shade(wall, 1.2), lo, hi),
    ramp: clampLuminance(opts.interiorColors?.ramp ?? shade(wall, 0.8), lo, hi),
  };
};

// ─── Interior: ramps, rooms, walls ──────────────────────────────────────────

/** Stories generate in order: the gap's ramp first (clear of the arrival rects from below, and of the
 *  exterior door zones on the ground floor), then the BSP around it. A shaft is NOT its own room:
 *  split walls never cross it, so it always lands wholly inside one leaf room. */
export const layoutStories = (
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
export const stretchSplitWallsToShell = (storyLayouts: StoryLayout[], m: Massing): void => {
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

/** A wall's boxes around its one doorway: the pieces left and right of it, and the lintel above. Doorways are as tall as
 *  the exterior doors. */
const addWallWithDoor = (boxes: WallBox[], w: SplitWall, ceilingHeight: number, doorwayHeight: number): void => {
  const a0 = w.doorAt - DOORWAY_WIDTH / 2;
  const a1 = w.doorAt + DOORWAY_WIDTH / 2;
  const segs: [number, number, number, number][] = []; // [from, to, y0, y1]
  if (a0 - w.from > 0.05) segs.push([w.from, a0, 0, ceilingHeight]);
  if (w.to - a1 > 0.05) segs.push([a1, w.to, 0, ceilingHeight]);
  if (ceilingHeight - doorwayHeight > 0.05) segs.push([Math.max(w.from, a0), Math.min(w.to, a1), doorwayHeight, ceilingHeight]);
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
export const buildWallBoxes = (rng: PlanRng, storyLayouts: StoryLayout[], ceilingHeight: number, doorwayHeight: number): WallBox[][] =>
  storyLayouts.map((layout) => {
    const boxes: WallBox[] = [];
    for (const w of layout.splitWalls) addWallWithDoor(boxes, w, ceilingHeight, doorwayHeight);
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
export const nudgeDoorsClearOfWalls = (doors: DoorPlan[], groundWalls: SplitWall[], intPts: Pt2[], bandPts: Pt2[]): void => {
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

const panelClearOfShell = (intPts: Pt2[], x: number, z: number): boolean => {
  const [hx, hz] = [LIGHT_PANEL_SIZE[0] / 2, LIGHT_PANEL_SIZE[1] / 2];
  return [-1, 1].every((sx) => [-1, 1].every((sz) => pointInRing(intPts, [x + sx * hx, z + sz * hz], LIGHT_PANEL_WALL_CLEARANCE)));
};

export const placeLightPanels = (rng: PlanRng, m: Massing, ramps: RampSpec[]): [number, number][][] => {
  const lightPanelsPerStory: [number, number][][] = [];
  for (let s = 0; s < m.stories; s++) {
    const holes = ramps.filter((r) => r.story === s).map((r) => r.hole);
    const panels: [number, number][] = [];
    for (let x = -m.interiorHalfWidth + LIGHT_PANEL_SPACING / 2; x < m.interiorHalfWidth - 1; x += LIGHT_PANEL_SPACING) {
      for (let z = -m.interiorHalfDepth + LIGHT_PANEL_SPACING / 2; z < m.interiorHalfDepth - 1; z += LIGHT_PANEL_SPACING) {
        if (!pointInRing(m.intPts, [x, z], 1)) continue;
        if (holes.some((h) => x > h.x0 - 1.6 && x < h.x1 + 1.6 && z > h.z0 - 1.6 && z < h.z1 + 1.6)) continue;
        // Drawn before the corner test so the rng stream (child slots after it) is unchanged.
        if (rng() > 0.15 && panelClearOfShell(m.intPts, x, z)) panels.push([x, z]);
      }
    }
    lightPanelsPerStory.push(panels);
  }
  return lightPanelsPerStory;
};

/** Dome lights: one per DOME_LIGHT_AREA of room (1–3), spaced along the room's long axis; none over a ramp hole. */
export const placeDomeLights = (m: Massing, storyLayouts: StoryLayout[], ramps: RampSpec[]): [number, number][][] =>
  storyLayouts.slice(0, m.stories).map((layout, s) => {
    const holes = ramps.filter((r) => r.story === s).map((r) => r.hole);
    const lights: [number, number][] = [];
    for (const r of layout.rooms) {
      const w = r.x1 - r.x0;
      const d = r.z1 - r.z0;
      const n = clamp(Math.round((w * d) / DOME_LIGHT_AREA), 1, 3);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = w >= d ? r.x0 + t * w : (r.x0 + r.x1) / 2;
        const z = w >= d ? (r.z0 + r.z1) / 2 : r.z0 + t * d;
        if (holes.some((h) => x > h.x0 - 1 && x < h.x1 + 1 && z > h.z0 - 1 && z < h.z1 + 1)) continue;
        lights.push([x, z]);
      }
    }
    return lights;
  });

/** Seeded spots for a building's `children`, each in a room and clear of the ramps. */
export const placeChildSlots = (rng: PlanRng, m: Massing, storyLayouts: StoryLayout[], ramps: RampSpec[]): ChildSlot[] => {
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
