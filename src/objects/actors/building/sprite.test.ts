import { packUnitPair, unpackUnitPair } from "../../sprite-lod/layout";
import { generateBuildingPlan } from "./generatePlan";
import { BUILDING_SPEC, buildingSeedAt, HOUSE_SPEC, SKYSCRAPER_SPEC } from "./spec";
import { describeBuildingSprite, HEIGHTS_OFFSET, PROFILE_POINTS, SPRITE_REFRESH_ANGLE, VIEW_SAMPLES, VIEW_WIDTHS_OFFSET } from "./sprite";
import type { BuildingAttributes } from "./types";

const describeSeeded = (hull: BuildingAttributes | undefined, seed: string) => describeBuildingSprite({ ...hull, seed }, 0, 0)!;

const heightsOf = (data: ArrayLike<number>): number[] =>
  Array.from({ length: PROFILE_POINTS / 2 }, (_, i) => unpackUnitPair(data[HEIGHTS_OFFSET + i])).flat();

/** widths[view][point], as fractions of the box width. */
const widthsOf = (data: ArrayLike<number>): number[][] => {
  const flat = Array.from({ length: (VIEW_SAMPLES * PROFILE_POINTS) / 2 }, (_, i) => unpackUnitPair(data[VIEW_WIDTHS_OFFSET + i])).flat();
  return Array.from({ length: VIEW_SAMPLES }, (_, k) => flat.slice(k * PROFILE_POINTS, (k + 1) * PROFILE_POINTS));
};

describe("building sprite", () => {
  it("is a pure function of seed and hull", () => {
    const a = describeSeeded(SKYSCRAPER_SPEC.hull, "s1");
    const b = describeSeeded(SKYSCRAPER_SPEC.hull, "s1");
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect([a.width, a.height]).toEqual([b.width, b.height]);
    expect(Array.from(describeSeeded(SKYSCRAPER_SPEC.hull, "s2").data)).not.toEqual(Array.from(a.data));
  });

  it("uses the position seed when no seed is set", () => {
    const at = describeBuildingSprite({ ...BUILDING_SPEC.hull }, 1200.4, -350.6)!;
    const seeded = describeSeeded(BUILDING_SPEC.hull, "1200_-351");
    expect(Array.from(at.data)).toEqual(Array.from(seeded.data));
  });

  it("is sized from the real plan", () => {
    for (let i = 0; i < 10; i++) {
      const sprite = describeSeeded(SKYSCRAPER_SPEC.hull, `tall${i}`);
      expect(sprite.height).toBeGreaterThanOrEqual(70);
      expect(sprite.height).toBeLessThan(140);
    }
  });

  it("covers the plan's body and stays within the bounds of its ground footprint", () => {
    const positions = Array.from({ length: 60 }, (_, i) => [i * 137 - 4000, i * -91 + 2500] as const);
    for (const spec of [BUILDING_SPEC, SKYSCRAPER_SPEC, HOUSE_SPEC]) {
      for (const [x, z] of positions) {
        const sprite = describeBuildingSprite({ ...spec.hull }, x, z)!;
        const plan = generateBuildingPlan(buildingSeedAt(x, z), spec.hull!);
        const bodyTop = Math.max(...plan.lofts.slice(0, plan.bodyLoftCount).flatMap((loft) => loft.levels.map((level) => level.y)));
        expect(sprite.height).toBeGreaterThanOrEqual(bodyTop - 1e-6);
        expect(sprite.width).toBeLessThan(Math.hypot(...plan.footprint) * 1.6);
        expect(sprite.width).toBeGreaterThan(Math.min(...plan.footprint) * 0.7);
      }
    }
  });

  it("profiles from the ground to the top, never going down", () => {
    for (const spec of [BUILDING_SPEC, SKYSCRAPER_SPEC, HOUSE_SPEC]) {
      for (let i = 0; i < 10; i++) {
        const heights = heightsOf(describeSeeded(spec.hull, `p${i}`).data);
        expect(heights[0]).toBe(0);
        expect(heights[PROFILE_POINTS - 1]).toBe(1);
        for (let j = 1; j < PROFILE_POINTS; j++) expect(heights[j]).toBeGreaterThanOrEqual(heights[j - 1]);
      }
    }
  });

  it("makes the box exactly as wide as the widest view", () => {
    for (let i = 0; i < 10; i++) {
      const widest = Math.max(...widthsOf(describeSeeded(SKYSCRAPER_SPEC.hull, `w${i}`).data).flat());
      expect(widest).toBeCloseTo(1, 3);
    }
  });

  it("narrows a house's hip roof above its walls", () => {
    for (let i = 0; i < 10; i++) {
      const widths = widthsOf(describeSeeded(HOUSE_SPEC.hull, `roof${i}`).data);
      for (const view of widths) expect(view[PROFILE_POINTS - 1]).toBeLessThan(view[0]);
    }
  });

  it("is as wide end-on and broadside as the plan is deep and wide", () => {
    let checked = 0;
    for (let i = 0; checked < 5 && i < 200; i++) {
      const seed = `rect${i}`;
      const plan = generateBuildingPlan(seed, HOUSE_SPEC.hull!);
      if (!plan.lofts[0].rect) continue;
      checked++;
      const widths = widthsOf(describeSeeded(HOUSE_SPEC.hull, seed).data);
      const broadside = 90 / SPRITE_REFRESH_ANGLE;
      // View 0 looks along x (sees the depth); the broadside view looks along z (sees the width).
      expect(widths[0][0] / widths[broadside][0]).toBeCloseTo(plan.footprint[1] / plan.footprint[0], 2);
    }
    expect(checked).toBe(5);
  });

  it("round-trips a 12-bit unit pair exactly", () => {
    for (const [high, low] of [
      [0, 0],
      [1, 1],
      [0.25, 0.75],
      [1, 0],
    ]) {
      const packed = Math.fround(packUnitPair(high, low));
      const [h, l] = unpackUnitPair(packed);
      expect(h).toBeCloseTo(high, 3);
      expect(l).toBeCloseTo(low, 3);
    }
  });
});
