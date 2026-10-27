import { useRef } from "react";
import { getVertexSample } from "../world/terrain/vertexData";
import { SAMPLE_GIVE_UP_MS } from "./groundSafetyNets";

/** Frames between water samples (the swim's surface and the underwater VFX). */
const PROBE_INTERVAL_FRAMES = 4;
/** A point this far under the sampled bed is under the ground (the bed is the raw lattice, not the drawn one). */
const UNDER_BED_MARGIN = 0.5;

export interface WaterProbe {
  /** Starts a sample at (x, z) every PROBE_INTERVAL_FRAMES (one in flight at a time). */
  sample(x: number, z: number): void;
  /** The last sampled water surface over a point at height `y`, or NaN where no water stands above the
   *  ground or the point is under its bed (a tunnel under a river is not in it). */
  surfaceOver(y: number): number;
  clear(): void;
}

/** The water surface around the player, from the same height pipeline that draws it, sampled on the
 *  dressing worker (on the main thread a cell's first sample built its river list: 58ms frames while
 *  flying). Raw (pad-free) is exact here: pads never stand in water, and the raw path keeps the water
 *  under bridge decks. No sample until the worker is up. */
export const useWaterProbe = (): WaterProbe => {
  // `since`: when the sample in flight started (-Infinity: none); one lost to a worker reset never resolves.
  const state = useRef({ surfaceY: NaN, bedY: NaN, frame: 0, since: -Infinity, generation: 0 }).current;
  return useRef<WaterProbe>({
    sample(x, z) {
      if (state.frame++ % PROBE_INTERVAL_FRAMES !== 0) return;
      const now = performance.now();
      if (now - state.since < SAMPLE_GIVE_UP_MS) return;
      state.since = now;
      const generation = state.generation;
      getVertexSample(x, z, { raw: true })
        .then((vd) => {
          if (!vd || generation !== state.generation) return;
          state.surfaceY = vd.waterHeight > vd.height ? vd.waterHeight : NaN;
          state.bedY = vd.height;
        })
        .finally(() => {
          state.since = -Infinity;
        });
    },
    surfaceOver: (y) => (y < state.bedY - UNDER_BED_MARGIN ? NaN : state.surfaceY),
    clear() {
      state.generation++;
      state.surfaceY = NaN;
      state.bedY = NaN;
    },
  }).current;
};
