import { EffectComposer, Pixelation } from "@react-three/postprocessing";
import { useEffect } from "react";
import { _quantization } from "../utils/quantization/quantization";
import { _curvature } from "./curvature";
import { setMainRenderFpsCap } from "./frameCap";

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
  pixelation,
  quantization,
  curvature,
  curvatureStart,
  fpsCap,
}: PostProcessingProps) => {
  useEffect(() => {
    if (quantization) {
      _quantization.setGridSize(quantization);
    }
  }, [quantization]);

  // The uniforms are module-level and survive a domain switch — reset, or a curved domain bends the flat one after it.
  useEffect(() => {
    _curvature.setCurvature(curvature, curvatureStart);
    return () => _curvature.setCurvature(0);
  }, [curvature, curvatureStart]);

  useEffect(() => {
    setMainRenderFpsCap(fpsCap);
    return () => setMainRenderFpsCap(undefined);
  }, [fpsCap]);

  if (!pixelation) return null;

  return (
    <EffectComposer>
      <Pixelation granularity={pixelation} />
    </EffectComposer>
  );
};
