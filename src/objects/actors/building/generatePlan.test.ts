import { generateBuildingPlan, LIGHT_PANEL_SIZE, luminanceOf } from "./generatePlan";
import { pointInRing, ringPoints } from "./rings";
import { LIGHT_TYPE } from "./types";
import { BUILDING_SPEC, HOUSE_SPEC, SKYSCRAPER_SPEC } from "./spec";

const SEEDS = Array.from({ length: 300 }, (_, i) => `${i * 61 - 9000}_${i * 37 + 11}`);

describe("generateBuildingPlan", () => {
  it("gives every door a luminance well apart from its band (outside) and the interior wall (inside)", () => {
    for (const spec of [BUILDING_SPEC, SKYSCRAPER_SPEC, HOUSE_SPEC]) {
      for (const seed of SEEDS) {
        const plan = generateBuildingPlan(seed, spec.hull!);
        const door = luminanceOf(plan.doorColor);
        // 0.14: the shade/mix land within a byte's rounding of the 0.15 target.
        for (const wall of [plan.lofts[0].color, plan.interior.colors.wall]) {
          expect(Math.abs(door - luminanceOf(wall))).toBeGreaterThanOrEqual(0.14);
        }
      }
    }
  });

  it("keeps every ceiling light inside the shell (a corner past it shows through a house's thin wall)", () => {
    for (const spec of [BUILDING_SPEC, SKYSCRAPER_SPEC, HOUSE_SPEC]) {
      for (const seed of SEEDS) {
        const plan = generateBuildingPlan(seed, spec.hull!);
        // A dome (radius 0.55) fits well inside its 1×1 box.
        const [hx, hz] = plan.interior.lightType === LIGHT_TYPE.DOME ? [0.5, 0.5] : [LIGHT_PANEL_SIZE[0] / 2, LIGHT_PANEL_SIZE[1] / 2];
        const band = plan.lofts[0];
        const outer = ringPoints(band.rect, band.sides, band.levels[1], band.ringRotation);
        for (const [x, z] of plan.interior.lightsPerStory.flat()) {
          for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
            expect(pointInRing(outer, [x + sx * hx, z + sz * hz], 0.2)).toBe(true);
          }
        }
      }
    }
  });

  it("lights houses with 1–3 domes per room and the city with panels", () => {
    for (const seed of SEEDS) {
      expect(generateBuildingPlan(seed, BUILDING_SPEC.hull!).interior.lightType).toBe(LIGHT_TYPE.PANEL);
      const { interior } = generateBuildingPlan(seed, HOUSE_SPEC.hull!);
      expect(interior.lightType).toBe(LIGHT_TYPE.DOME);
      for (let s = 0; s < interior.stories; s++) {
        for (const r of interior.roomsPerStory[s]) {
          const inRoom = interior.lightsPerStory[s].filter(([x, z]) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1);
          expect(inRoom.length).toBeLessThanOrEqual(3);
          // A room may lose its domes only to a ramp hole overhead.
          const rampOverhead = interior.ramps.some((rp) => rp.story === s);
          expect(rampOverhead || inRoom.length >= 1).toBe(true);
        }
      }
    }
  });
});
