import { Physics } from "@react-three/cannon";
import { Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { ObjectPool } from "../../objects/ObjectPool";
import { Player } from "../../player/Player";
import { PostProcessing } from "../../vfx/PostProcessing";
import { Terrain } from "../../world/terrain/Terrain";
import { Dimension, Region } from "../../world/types";
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
        <PostProcessing />
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 5]} intensity={1} />
        <Physics
          gravity={[0, -9.81, 0]}
          defaultContactMaterial={{
            friction: 0.5,
            restitution: 0.7,
            contactEquationStiffness: 1e6,
            contactEquationRelaxation: 3,
          }}
          broadphase="SAP" // Sweep and Prune broadphase
          allowSleep={true} // Allows bodies to sleep for performance
          iterations={8} // Solver iterations
          tolerance={0.001} // Solver tolerance
        >
          {/* <Debug> */}
          <Player />
          <Terrain dimension={GlitchCity} />
          <ObjectPool dimension={GlitchCity} />
          {/* </Debug> */}
        </Physics>
      </Canvas>
    );
  },
};
