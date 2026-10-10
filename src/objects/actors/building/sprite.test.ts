import { packUnitPair, unpackUnitPair } from "../../sprite-lod/layout";
import { generateBuildingPlan } from "./generatePlan";
import { BUILDING_SPEC, buildingSeedAt, HOUSE_SPEC, SKYSCRAPER_SPEC } from "./spec";
import { describeBuildingSprite, OUTLINE_OFFSET, PROFILE_POINTS } from "./sprite";
import type { BuildingAttributes } from "./types";

const describeSeeded = (hull: BuildingAttributes | undefined, seed: string) => describeBuildingSprite({ ...hull, seed }, 0, 0)!;

const outlineOf = (data: ArrayLike<number>): [number, number][] =>
  Array.from({ length: PROFILE_POINTS }, (_, i) => unpackUnitPair(data[OUTLINE_OFFSET + i]));
const heightsOf = (data: ArrayLike<number>): number[] => outlineOf(data).map(([height]) => height);
/** As fractions of the box width. */
const widthsOf = (data: ArrayLike<number>): number[] => outlineOf(data).map(([, width]) => width);

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

  it("makes the box exactly as wide as the widest height", () => {
    for (let i = 0; i < 10; i++) {
      const widest = Math.max(...widthsOf(describeSeeded(SKYSCRAPER_SPEC.hull, `w${i}`).data));
      expect(widest).toBeCloseTo(1, 3);
    }
  });

  it("narrows a house's hip roof above its walls", () => {
    for (let i = 0; i < 10; i++) {
      const widths = widthsOf(describeSeeded(HOUSE_SPEC.hull, `roof${i}`).data);
      expect(widths[PROFILE_POINTS - 1]).toBeLessThan(widths[0]);
    }
  });

  it("draws a rectangular house at its mean width, perimeter ÷ π", () => {
    let checked = 0;
    for (let i = 0; checked < 5 && i < 200; i++) {
      const seed = `rect${i}`;
      const plan = generateBuildingPlan(seed, HOUSE_SPEC.hull!);
      if (!plan.lofts[0].rect) continue;
      checked++;
      const sprite = describeSeeded(HOUSE_SPEC.hull, seed);
      const [w, d] = plan.footprint;
      expect(widthsOf(sprite.data)[0] * sprite.width).toBeCloseTo((2 * (w + d)) / Math.PI, 1);
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
