import { Debug, Physics } from "@react-three/cannon";
import { Canvas } from "@react-three/fiber";
import { GameContextProvider, useGameContext } from "../context/GameContext";
import { useUrlParameters } from "../context/UrlParametersContext";
import { Overlay } from "../menus/overlay/Overlay";
import { ObjectPool } from "../objects/spawning/ObjectPool";
import { Player } from "../player/Player";
import { Terrain } from "../world/terrain/Terrain";

const OBJECT_LOAD_THRESHOLD = 0.2; //TODO make this 1 for release, keep it low for testing

const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { terrain_loaded, progress } = useGameContext();
  const { params } = useUrlParameters();

  // Default physics properties
  const defaultPhysicsProps = {
    gravity: [0, -100, 0],
    defaultContactMaterial: {
      friction: 0,
      restitution: 0,
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
      <Overlay />
      {/* <PostProcessing /> */}
      <Physics {...(mergedPhysicsProps as any)}>
        {params.debug ? (
          <Debug color="red">
            {children}
            <Terrain />
            <ObjectPool />
          </Debug>
        ) : (
          <>
            {children}
            <Terrain />
            <ObjectPool />
          </>
        )}
        <Player />
      </Physics>
    </>
  );
};

export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  // Default canvas properties
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  // Merge default and user-provided canvas props
  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <PreCustomCanvas>{children}</PreCustomCanvas>
      </GameContextProvider>
    </Canvas>
  );
};
