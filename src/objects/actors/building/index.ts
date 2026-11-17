import seedrandom from "seedrandom";
import { clamp } from "../../../utils/math";
import { inscribedRectFactor, ringPoints } from "./utils";
import { BuildingAttributes, BuildingPlan, RoomRect } from "./types";
import { LIGHT_TYPE, ROOF_STYLE } from "./enums";
import type { PlanRng, Massing } from "./types";
import { createShellRings, createSegmentColors, buildLofts, chooseDoorLook, placeDoors, placeWindows, windowOverlapsDoor } from "./exterior";
import { interiorColorsOf, layoutStories, stretchSplitWallsToShell, buildWallBoxes, nudgeDoorsClearOfWalls, placeDomeLights, placeLightPanels, placeChildSlots } from "./interior";
import { FOUNDATION_DEPTH, DEFAULT_SIDES, SLAB_THICKNESS, MAX_STORIES, RAMP_RUN_FACTOR, RAMP_LANDING, RAMP_WIDTH, WALKWAY_WIDTH, SHELL_INSET, MAX_INTERIOR_HALF, RAMP_RUN_MIN_FACTOR, MAX_GROWN_INTERIOR_HALF, DEFAULT_WIDTH_SCALE } from "./constants";

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

export const generateBuildingPlan = (seed: string, opts: BuildingAttributes): BuildingPlan => {
  const rng = createPlanRng(seed);
  const m = sizeMassing(rng, opts);
  const shellHeight = chooseShellHeight(rng, opts, m);
  const ringAt = createShellRings(rng, opts, m, shellHeight);
  const segmentColor = createSegmentColors(rng, opts, m.pitched);
  const { lofts, bandTop, bandColor, segBounds } = buildLofts(rng, opts, m, shellHeight, ringAt, segmentColor);
  const interiorColors = interiorColorsOf(opts, bandColor);
  const { doorColor, doorHandle } = chooseDoorLook(rng, lofts, bandColor, interiorColors.wall);
  const bandPts = ringPoints(m.rect, m.sides, bandTop, m.ringRotation);
  const doors = placeDoors(rng, opts, m, bandPts);
  const placedWindows = placeWindows(rng, opts, m, lofts, segBounds, bandPts, shellHeight);
  const { ramps, storyLayouts } = layoutStories(rng, m, doors);
  stretchSplitWallsToShell(storyLayouts, m);
  const wallBoxesPerStory = buildWallBoxes(rng, storyLayouts, m.ceilingHeight, m.doorHeight);
  nudgeDoorsClearOfWalls(doors, storyLayouts[0].splitWalls, m.intPts, bandPts);
  const windows = placedWindows.filter((w) => !windowOverlapsDoor(w, doors, bandPts));
  const lightType = opts.lightType ?? LIGHT_TYPE.PANEL;
  const lightsPerStory =
    lightType === LIGHT_TYPE.DOME ? placeDomeLights(m, storyLayouts, ramps) : placeLightPanels(rng, m, ramps);
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
    doorHandle,
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
      lightType,
      lightsPerStory,
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

  const ceilingHeight = opts.ceilingHeight ?? 7.2;
  const storyHeight = ceilingHeight + SLAB_THICKNESS;
  const doorWidth = opts.doorSize?.[0] ?? 2.6;
  const doorHeight = Math.min(opts.doorSize?.[1] ?? 3.84, ceilingHeight - 0.2);
  const doorBandTop = doorHeight + rng.range(0.8, 2);

  const storyRoll = Array.isArray(opts.stories)
    ? opts.stories.length
      ? rng.pick(opts.stories)
      : rng.rangeInt(1, 5)
    : opts.stories ?? rng.rangeInt(1, 5);
  const requestedStories = clamp(Math.round(storyRoll), 1, MAX_STORIES);
  const roomChoices = (
    Array.isArray(opts.roomCount) ? opts.roomCount : opts.roomCount !== undefined ? [opts.roomCount] : null
  )?.map((n) => Math.max(1, Math.round(n)));
  const pickRoomCount = (): number => (roomChoices?.length ? rng.pick(roomChoices) : rng.rangeInt(3, 6));
  // A floor rolling more rooms than fit just gets a denser split (BSP stops early).
  const maxRoomCount = roomChoices?.length ? Math.max(...roomChoices) : rng.rangeInt(4, 6);
  const roomArea = rng.range(70, 110);
  const shaftLen = storyHeight * RAMP_RUN_FACTOR + 2 * RAMP_LANDING;
  const shaftWidth = RAMP_WIDTH + WALKWAY_WIDTH;
  // Near-square when multi-story so the inscribed room block fits the shaft. `aspectRange` is rolled
  // log-uniform, so 1/k and k are equally likely; a multi-story plan too stretched for its shaft grows to fit.
  const aspect = opts.aspectRange
    ? Math.exp(rng.range(Math.log(opts.aspectRange[0]), Math.log(opts.aspectRange[1])))
    : requestedStories > 1
      ? rng.range(0.92, 1.08)
      : rng.range(0.8, 1.25);

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
  if (!opts.exteriorSize) {
    // After the shaft fit: widening only enlarges the block, so the fit holds.
    const [scaleMin, scaleMax] = opts.widthScale ?? DEFAULT_WIDTH_SCALE;
    const widthScale = rng.range(scaleMin, scaleMax);
    interiorHalfWidth *= widthScale;
    interiorHalfDepth *= widthScale;
    block = blockOf(interiorHalfWidth, interiorHalfDepth);
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
    pitched: opts.roof === ROOF_STYLE.PITCHED,
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
  // Eaves just above the top ceiling: the roof, not the wall, gives a house its height.
  if (m.pitched) return m.stories * m.storyHeight + rng.range(0.7, 1.3);
  if (opts.shellHeightRange && m.stories === m.requestedStories) {
    return Math.max(rng.range(opts.shellHeightRange[0], opts.shellHeightRange[1]), m.stories * m.storyHeight + 2);
  }
  if (m.stories === 1) return m.storyHeight + rng.range(3, 16);
  // Even the shortest 2-story shell clears the tallest 1-story one, and a
  // shell of height H never suggests FEWER floors than it has (~30u ⇒ 2, ~48u ⇒ 3, ~60u ⇒ 4).
  return m.stories * m.storyHeight + rng.range(8, 12) + m.stories * (m.stories <= 2 ? rng.range(2.5, 4.5) : rng.range(5, 7));
};
