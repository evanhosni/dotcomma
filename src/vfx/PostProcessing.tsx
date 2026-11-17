import { useEffect } from "react";
import { _quantization, _curvature } from "./material";
import { QuantizationGrowth } from "./types";
import { setMainRenderFpsCap, setPixelation } from "./store";
import { DREAM, DEEP_DREAM, TRACE } from "./screen-pass/store";
import { preloadDeepDream } from "./screen-pass/deep-dream/worker";

interface PostProcessingProps {
  pixelation?: number;
  quantization?: number;
  /** The farther a vertex, the coarser it snaps (vfx/material.ts): nothing inside `start`, then
   *  size × (km past start)^power. Unset = the base grid everywhere. */
  quantizationGrowth?: QuantizationGrowth;
  /** Illusory planet radius in world units (vfx/material.ts); 20000 drops 20u at 1000u out. Unset/0 = flat. */
  curvature?: number;
  /** Flat zone around the player (default 100) — every interaction reach must sit inside it. */
  curvatureStart?: number;
  /** Presented frames only; the rAF loop keeps display rate (vfx/store.ts). Unset/0 = uncapped. */
  fpsCap?: number;
  /** The shader imitation of a dream (vfx/screen-pass/DreamPass.ts), 0–1: no network, nearly free. Unset/0 = off. */
  dream?: number;
  /** Real DeepDream (MobileNet on a worker, vfx/screen-pass/deep-dream/) shown at this strength, 0–1. Unset/0 = off. */
  deepDream?: number;
  /** The window trail (vfx/screen-pass/TracePass.ts), 0–1: how long the stamped copies persist. Unset/0 = off. */
  trace?: number;
}

export const PostProcessing = ({
  pixelation: pixelationProp,
  quantization,
  quantizationGrowth,
  curvature,
  curvatureStart,
  fpsCap,
  dream,
  deepDream,
  trace,
}: PostProcessingProps) => {
  // The uniforms are module-level and survive a domain switch — reset each on unmount, or a
  // quantized/curved/capped domain leaks its setting into the next one.
  useEffect(() => {
    if (!quantization) return;
    _quantization.setGridSize(quantization);
    return () => _quantization.setGridSize(0);
  }, [quantization]);

  useEffect(() => {
    if (!quantizationGrowth) return;
    _quantization.setGridGrowth(quantizationGrowth);
    return () => _quantization.setGridGrowth({ size: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a literal prop: its fields, not its identity
  }, [quantizationGrowth?.start, quantizationGrowth?.size, quantizationGrowth?.power]);

  useEffect(() => {
    _curvature.setCurvature(curvature, curvatureStart);
    return () => _curvature.setCurvature(0);
  }, [curvature, curvatureStart]);

  useEffect(() => {
    setMainRenderFpsCap(fpsCap);
    return () => setMainRenderFpsCap(undefined);
  }, [fpsCap]);

  useEffect(() => {
    DREAM.strength = dream ?? 0;
    return () => {
      DREAM.strength = 0;
    };
  }, [dream]);

  useEffect(() => {
    DEEP_DREAM.strength = deepDream ?? 0;
    if (deepDream) preloadDeepDream();
    return () => {
      DEEP_DREAM.strength = 0;
    };
  }, [deepDream]);

  useEffect(() => {
    TRACE.strength = trace ?? 0;
    return () => {
      TRACE.strength = 0;
    };
  }, [trace]);

  useEffect(() => {
    setPixelation(pixelationProp ?? 0);
    return () => setPixelation(0);
  }, [pixelationProp]);

  return null;
};
