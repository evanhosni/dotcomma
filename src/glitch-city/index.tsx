import { Canvas } from "@react-three/fiber";
import { Controls } from "../_/player/controls/Controls";
import { Terrain } from "../_/terrain/Terrain";
import { GlitchCityProperties } from "./properties";

export const GlitchCity = () => {
  return (
    <Canvas>
      <Controls />
      {/* TODO <Settings (gravity and such)/> */}
      <Terrain
        getHeight={GlitchCityProperties.getHeight}
        getMaterial={GlitchCityProperties.getMaterial}
      />
    </Canvas>
  );
};
