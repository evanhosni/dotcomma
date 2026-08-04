import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect } from "react";
import { useDevMode } from "../context/DevContext";
import { GameContextProvider } from "../context/GameContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { PortalContextProvider } from "../portals/PortalContext";
import { initCursor } from "../utils/cursor/cursor";
import { GameWorld } from "./GameWorld";

/** Portal useFrame hooks use non-zero priorities (-1, 1), which disables R3F's
 *  auto-rendering. This component replaces it with an explicit render at the end. */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    gl.render(scene, camera);
  }, 2);
  return null;
};

const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { physicsDebug } = useDevMode();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <color attach="background" args={["#555555"]} />
      <SceneRender />
      <Overlay />
      <Physics gravity={[0, -100, 0]} debug={physicsDebug}>
        {children}
        <GameWorld />
        <Player />
      </Physics>
    </>
  );
};

/** PreCustomCanvas needs PortalContext, so wrap it */
const PreCustomCanvasWithPortal = ({ children }: React.PropsWithChildren) => (
  <PortalContextProvider>
    <PreCustomCanvas>{children}</PreCustomCanvas>
  </PortalContextProvider>
);

export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  const defaultCanvasProps = {
    style: { background: "#555" },
  };

  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <PreCustomCanvasWithPortal>{children}</PreCustomCanvasWithPortal>
      </GameContextProvider>
    </Canvas>
  );
};
