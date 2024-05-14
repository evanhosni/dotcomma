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
  name: "city",
  biomes: [City, Grass],
};

export const GrassRegion: Region = {
  name: "grass",
  biomes: [Grass],
};

export const DesertRegion: Region = {
  name: "desert",
  biomes: [Dust],
};

export const GlitchCityDimension: Dimension = {
  name: "glitch-city",
  regions: [CityRegion, GrassRegion, DesertRegion],
  getVertexData: getVertexData,
  getMaterial: getMaterial,
  getSpawners: getSpawners,
};

export const GlitchCity = () => {
  return (
    <Canvas style={{ background: "#000" }}>
      <Stats />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Physics>
        <Player />
      </Physics>
      <Physics>
        <Terrain dimension={GlitchCityDimension} />
      </Physics>
    </Canvas>
  );
};
