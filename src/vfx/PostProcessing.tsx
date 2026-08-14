// PostProcessing.tsx
import { EffectComposer, Pixelation } from "@react-three/postprocessing";
import { useEffect } from "react";
import { _quantization } from "../utils/quantization/quantization";
import { setMainRenderFpsCap } from "./frameCap";

interface PostProcessingProps {
  pixelation?: number;
  quantization?: number;
  /** Cap on PRESENTED frames (main camera only). The rAF loop — physics,
   *  state machines, everything dt-based — keeps running at display rate;
   *  only the final gl.render skips. A steady
   *  60 reads smoother than a fluctuating 100. Unset/0 = uncapped. */
  fpsCap?: number;
}

export const PostProcessing = ({ pixelation, quantization, fpsCap }: PostProcessingProps) => {
  useEffect(() => {
    if (quantization) {
      _quantization.setGridSize(quantization);
    }
  }, [quantization]);

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
