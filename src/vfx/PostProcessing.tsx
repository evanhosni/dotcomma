// PostProcessing.tsx
import { EffectComposer, Pixelation } from "@react-three/postprocessing";
import { useEffect } from "react";
import { _quantization } from "../utils/quantization/quantization";

interface PostProcessingProps {
  pixelation?: number;
  quantization?: number;
}

export const PostProcessing = ({ pixelation, quantization }: PostProcessingProps) => {
  useEffect(() => {
    if (quantization) {
      _quantization.setGridSize(quantization);
    }
  }, [quantization]);

  if (!pixelation) return null;

  return (
    <EffectComposer>
      <Pixelation granularity={pixelation} />
    </EffectComposer>
  );
};
