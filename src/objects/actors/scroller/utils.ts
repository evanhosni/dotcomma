import { seededStream } from "../../../utils/math";
import type { VehicleStats } from "../../../physics/vehicle/types";
import { SCROLLER_COLORS } from "./constants";

/** One car's paint and performance, rolled from its id (position-based: the same car parked in the
 *  same spot is the same car every visit). Placeholder until stats are designed. */
export const rollScroller = (id: string): { stats: VehicleStats; colorIndex: number } => {
  const roll = seededStream(`scroller:${id}`);
  return {
    colorIndex: roll.intBetween(0, SCROLLER_COLORS.length - 1),
    stats: {
      topSpeed: roll.between(70, 130),
      acceleration: roll.between(35, 75),
      braking: roll.between(80, 160),
      handling: roll.next(),
      offRoad: roll.next(),
    },
  };
};

/** Stats as 0..1 bars, for the HUD. */
export const statRatings = (stats: VehicleStats): Array<[string, number]> => [
  ["speed", (stats.topSpeed - 70) / 60],
  ["accel", (stats.acceleration - 35) / 40],
  ["brakes", (stats.braking - 80) / 80],
  ["handling", stats.handling],
  ["off-road", stats.offRoad],
];
