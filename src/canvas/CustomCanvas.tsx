import { Physics } from "@react-three/cannon";
import { Stats } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { GameContextProvider } from "../context/GameContext";
import { ObjectPool } from "../objects/ObjectPool";
import { Player } from "../player/Player";
import { PostProcessing } from "../vfx/PostProcessing";
import { Terrain } from "../world/terrain/Terrain";
import { CustomCanvasProps } from "./types";

export const CustomCanvas = ({ dimension, children }: CustomCanvasProps) => {
  // Default physics properties
  const defaultPhysicsProps = {
    gravity: [0, -9.81, 0],
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

  // Default canvas properties
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  // Merge default and user-provided canvas props
  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <Stats />
        <PostProcessing />
        <Physics {...(mergedPhysicsProps as any)}>
          {children}
          <Terrain dimension={dimension} />
          <ObjectPool dimension={dimension} />
          <Player />
        </Physics>
      </GameContextProvider>
    </Canvas>
  );
};
