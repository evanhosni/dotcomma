import { Physics } from "@react-three/cannon";
import { Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { GameContextProvider, useGameContext } from "../context/GameContext";
import { Player } from "../player/Player";
import { PostProcessing } from "../vfx/PostProcessing";
import { Terrain } from "../world/terrain/Terrain";
import { CustomCanvasProps } from "./types";

const OBJECT_LOAD_THRESHOLD = 0.2; //TODO make this 1 for release, keep it low for testing

const PreCustomCanvas = ({ dimension, children }: CustomCanvasProps) => {
  const { terrain_loaded, progress } = useGameContext();

  // Default physics properties
  const defaultPhysicsProps = {
    gravity: [0, -90.81, 0],
    defaultContactMaterial: {
      friction: 0.5,
      restitution: 0.7,
      contactEquationStiffness: 1e6,
      contactEquationRelaxation: 3,
    },
    broadphase: "SAP", // Sweep and Prune broadphase
    allowSleep: true, // Allows bodies to sleep for performance
    iterations: 8, // Solver iterations
    tolerance: 0.001, // Solver tolerance
  };

  // Merge default and user-provided physics props
  const mergedPhysicsProps = { ...defaultPhysicsProps };

  return (
    <>
      <Stats />
      <PostProcessing />
      <Physics {...(mergedPhysicsProps as any)}>
        {children}
        <Terrain dimension={dimension} />
        {/* <ObjectPool dimension={dimension} /> */}
        {/* {(terrain_loaded || progress >= OBJECT_LOAD_THRESHOLD) && <ObjectPool dimension={dimension} />} */}
        {/* //TODO either dont allow player to move until terrain_loaded or remove this check altogether. progress can go down again so dont make that the only check */}
        <Player />
      </Physics>
    </>
  );
};

export const CustomCanvas = ({ dimension, children }: CustomCanvasProps) => {
  // Default canvas properties
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  // Merge default and user-provided canvas props
  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <PreCustomCanvas dimension={dimension}>{children}</PreCustomCanvas>
      </GameContextProvider>
    </Canvas>
  );
};
