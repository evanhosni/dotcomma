// PostProcessing.tsx
import { EffectComposer, Pixelation } from "@react-three/postprocessing";

export const PostProcessing = () => {
  return (
    <EffectComposer>
      <Pixelation granularity={3} />
    </EffectComposer>
  );
};
