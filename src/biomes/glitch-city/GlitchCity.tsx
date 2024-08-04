import { Physics } from "@react-three/cannon";
import { Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Player } from "../../player/Player";
import { Terrain } from "../../terrain/Terrain";
import { Dimension } from "../../types/Dimension";
import { Region } from "../../types/Region";
import { City } from "../city/City";
import { Dust } from "../dust/Dust";
import { Grass } from "../grass/Grass";
import { getMaterial } from "./getMaterial";
import { getSpawners } from "./getSpawners";
import { getVertexData } from "./getVertexData";

export const CityRegion: Region = {
  biomes: [City, Grass],
};

export const GrassRegion: Region = {
  biomes: [Grass],
};

export const DesertRegion: Region = {
  biomes: [Dust],
};

export const GlitchCity: Dimension = {
  name: "glitch-city",
  regions: [CityRegion /*, GrassRegion, DesertRegion*/],
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  getSpawners: getSpawners,
  component: () => {
    return (
      <Canvas style={{ background: "#555" }}>
        <Stats />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Physics>
          {/* <Debug> */}
          <Player />
          <Terrain dimension={GlitchCity} />
          {/* </Debug> */}
        </Physics>
      </Canvas>
    );
  },
};
