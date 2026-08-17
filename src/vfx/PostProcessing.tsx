// PostProcessing.tsx
import { EffectComposer, Pixelation } from "@react-three/postprocessing";
import { useEffect } from "react";
import { _quantization } from "../utils/quantization/quantization";
import { _curvature } from "./curvature";
import { setMainRenderFpsCap } from "./frameCap";

interface PostProcessingProps {
  pixelation?: number;
  quantization?: number;
  /** WORLD CURVATURE — the illusory planet radius, in world units. Past
   *  `curvatureStart` units from the camera every vertex sinks by
   *  (d - start)² / (2 × radius), so the ground falls away behind a curved
   *  horizon (see vfx/curvature.ts). Purely visual — physics stays flat.
   *  Smaller = rounder: 20000 drops 20u at 1000 units out, 90u at 2000.
   *  Unset/0 = flat. */
  curvature?: number;
  /** Radius of the FLAT zone around the player (default 100). Nothing inside
   *  it moves, so interaction and the ground underfoot are never displaced. */
  curvatureStart?: number;
  /** Cap on PRESENTED frames (main camera only). The rAF loop — physics,
   *  state machines, everything dt-based — keeps running at display rate;
   *  only the final gl.render skips. A steady
   *  60 reads smoother than a fluctuating 100. Unset/0 = uncapped. */
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

  // Reset on unmount: the uniforms are module-level and survive a domain
  // switch, so a curved domain would otherwise bend a flat one after it.
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
