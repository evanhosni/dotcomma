import { useThree } from "@react-three/fiber";
import { useEffect, useSyncExternalStore } from "react";
import { _quantization } from "./quantization";
import { _curvature } from "./curvature";
import { setMainRenderFpsCap } from "./frameCap";

/** Screen pixels per rendered pixel (≤ 1 = off). Drawn by lowering the canvas's pixel ratio and letting the
 *  browser upscale with hard edges (PixelationDriver): a post-process pass fought CustomCanvas's own render
 *  loop (every frame drawn twice, every program relinked, ~2 fps) and cost fill rate instead of saving it. */
let pixelation = 0;
const pixelationListeners = new Set<() => void>();
const subscribePixelation = (fn: () => void): (() => void) => {
  pixelationListeners.add(fn);
  return () => {
    pixelationListeners.delete(fn);
  };
};
export const getPixelation = (): number => pixelation;
/** The domain's prop sets it on mount, devmode live (vfx/tuning.ts). */
export const setPixelation = (granularity: number): void => {
  pixelation = granularity;
  pixelationListeners.forEach((fn) => fn());
};

interface PostProcessingProps {
  pixelation?: number;
  quantization?: number;
  /** Illusory planet radius in world units (vfx/curvature.ts); 20000 drops 20u at 1000u out. Unset/0 = flat. */
  curvature?: number;
  /** Flat zone around the player (default 100) — every interaction reach must sit inside it. */
  curvatureStart?: number;
  /** Presented frames only; the rAF loop keeps display rate (vfx/frameCap.ts). Unset/0 = uncapped. */
  fpsCap?: number;
}

export const PostProcessing = ({
  pixelation: pixelationProp,
  quantization,
  curvature,
  curvatureStart,
  fpsCap,
}: PostProcessingProps) => {
  // The uniforms are module-level and survive a domain switch — reset each on unmount, or a
  // quantized/curved/capped domain leaks its setting into the next one.
  useEffect(() => {
    if (!quantization) return;
    _quantization.setGridSize(quantization);
    return () => _quantization.setGridSize(0);
  }, [quantization]);

  useEffect(() => {
    _curvature.setCurvature(curvature, curvatureStart);
    return () => _curvature.setCurvature(0);
  }, [curvature, curvatureStart]);

  useEffect(() => {
    setMainRenderFpsCap(fpsCap);
    return () => setMainRenderFpsCap(undefined);
  }, [fpsCap]);

  useEffect(() => {
    setPixelation(pixelationProp ?? 0);
    return () => setPixelation(0);
  }, [pixelationProp]);

  return null;
};

/** Applies the pixelation to the ONE canvas (mounted by CustomCanvas, so it outlives every domain). */
export const PixelationDriver = ({ baseDpr }: { baseDpr: number }) => {
  const setDpr = useThree((state) => state.setDpr);
  const canvas = useThree((state) => state.gl.domElement);
  const granularity = useSyncExternalStore(subscribePixelation, getPixelation);
  useEffect(() => {
    const on = granularity > 1;
    setDpr(on ? baseDpr / granularity : baseDpr);
    canvas.style.imageRendering = on ? "pixelated" : "";
  }, [granularity, baseDpr, setDpr, canvas]);
  return null;
};
