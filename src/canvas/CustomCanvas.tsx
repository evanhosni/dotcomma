import { Physics } from "@react-three/rapier";
import { Canvas } from "@react-three/fiber";
import { useEffect } from "react";
import { GameContextProvider, useGameContext } from "../context/GameContext";
import { useDevMode } from "../context/DevContext";
import { Overlay } from "../menus/overlay/Overlay";
import { ObjectPool } from "../objects/spawning/ObjectPool";
import { Player } from "../player/Player";
import { initCursor } from "../utils/cursor/cursor";
import { PostProcessing } from "../vfx/PostProcessing";
import { Terrain } from "../world/terrain/Terrain";

const OBJECT_LOAD_THRESHOLD = 0.2; //TODO make this 1 for release, keep it low for testing

const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { terrain_loaded, progress } = useGameContext();
  const { physicsDebug } = useDevMode();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <Overlay />
      <PostProcessing quantization={0.025} />
      <Physics gravity={[0, -100, 0]} debug={physicsDebug}>
        {children}
        <Terrain />
        <ObjectPool />
        <Player />
      </Physics>
    </>
  );
};

export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <PreCustomCanvas>{children}</PreCustomCanvas>
      </GameContextProvider>
    </Canvas>
  );
};
