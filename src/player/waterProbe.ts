import { useRef } from "react";
import { getVertexDataRaw } from "../world/terrain/vertexData";

/** Frames between water samples (the swim's surface and the underwater VFX). */
const PROBE_INTERVAL_FRAMES = 4;

export interface WaterProbe {
  /** Starts a sample at (x, z) every PROBE_INTERVAL_FRAMES (one in flight at a time). */
  sample(x: number, z: number): void;
  /** The last sampled water surface, or NaN where no water stands above the ground. */
  surfaceY(): number;
  clear(): void;
}

/** The water surface around the player, from the same height pipeline that draws it. Raw (pad-free) is
 *  exact here: pads never stand in water, and the raw path keeps the water under bridge decks. */
export const useWaterProbe = (): WaterProbe => {
  const state = useRef({ surfaceY: NaN, frame: 0, pending: false, generation: 0 }).current;
  return useRef<WaterProbe>({
    sample(x, z) {
      if (state.pending || state.frame++ % PROBE_INTERVAL_FRAMES !== 0) return;
      state.pending = true;
      const generation = state.generation;
      getVertexDataRaw(x, z)
        .then((vd) => {
          if (generation === state.generation) state.surfaceY = vd.waterHeight > vd.height ? vd.waterHeight : NaN;
        })
        .finally(() => {
          state.pending = false;
        });
    },
    surfaceY: () => state.surfaceY,
    clear() {
      state.generation++;
      state.surfaceY = NaN;
    },
  }).current;
};
