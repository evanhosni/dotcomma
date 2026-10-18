import { useRef } from "react";
import { getVertexSample } from "../world/terrain/vertexData";
import { SAMPLE_GIVE_UP_MS } from "./groundSafetyNets";

/** Frames between water samples (the swim's surface and the underwater VFX). */
const PROBE_INTERVAL_FRAMES = 4;

export interface WaterProbe {
  /** Starts a sample at (x, z) every PROBE_INTERVAL_FRAMES (one in flight at a time). */
  sample(x: number, z: number): void;
  /** The last sampled water surface, or NaN where no water stands above the ground. */
  surfaceY(): number;
  clear(): void;
}

/** The water surface around the player, from the same height pipeline that draws it, sampled on the
 *  dressing worker (on the main thread a cell's first sample built its river list: 58ms frames while
 *  flying). Raw (pad-free) is exact here: pads never stand in water, and the raw path keeps the water
 *  under bridge decks. No sample until the worker is up. */
export const useWaterProbe = (): WaterProbe => {
  // `since`: when the sample in flight started (-Infinity: none); one lost to a worker reset never resolves.
  const state = useRef({ surfaceY: NaN, frame: 0, since: -Infinity, generation: 0 }).current;
  return useRef<WaterProbe>({
    sample(x, z) {
      if (state.frame++ % PROBE_INTERVAL_FRAMES !== 0) return;
      const now = performance.now();
      if (now - state.since < SAMPLE_GIVE_UP_MS) return;
      state.since = now;
      const generation = state.generation;
      getVertexSample(x, z, { raw: true })
        .then((vd) => {
          if (vd && generation === state.generation) state.surfaceY = vd.waterHeight > vd.height ? vd.waterHeight : NaN;
        })
        .finally(() => {
          state.since = -Infinity;
        });
    },
    surfaceY: () => state.surfaceY,
    clear() {
      state.generation++;
      state.surfaceY = NaN;
    },
  }).current;
};
