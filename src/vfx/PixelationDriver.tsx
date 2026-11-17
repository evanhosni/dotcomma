import { useThree } from "@react-three/fiber";
import { useEffect, useSyncExternalStore } from "react";
import { subscribePixelation, getPixelation } from "./store";

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
