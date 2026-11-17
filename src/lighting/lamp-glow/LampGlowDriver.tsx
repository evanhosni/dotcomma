import { useFrame } from "@react-three/fiber";
import { glowEntries, driveLampLighting } from ".";

/** Drives the grid every frame while any head is lit. Mounted once, in CustomCanvas. */
export const LampGlowDriver = (): null => {
  useFrame((state) => {
    if (glowEntries.size > 0) driveLampLighting(state.camera, state.clock.elapsedTime);
  });
  return null;
};
