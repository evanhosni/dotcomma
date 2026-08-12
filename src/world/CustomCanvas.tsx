import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect } from "react";
import { useDevMode } from "../context/DevContext";
import { GameContextProvider } from "../context/GameContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { PortalContextProvider } from "../portals/PortalContext";
import { DayNightProvider } from "../sky/DayNightContext";
import { initCursor } from "../utils/cursor/cursor";

/** Portal useFrame hooks use non-zero priorities (-1, 1), which disables R3F's
 *  auto-rendering. This component replaces it with an explicit render at the end. */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    gl.render(scene, camera);
  }, 2);
  return null;
};

interface CustomCanvasProps extends React.PropsWithChildren {
  /** Scene/canvas background color (home page overrides to black). */
  background?: string;
  /** Where the player's FEET spawn (ground-level position). Unset = the
   *  default sky drop onto the terrain. Home page: [0, 0, 0]. */
  playerSpawn?: [number, number, number];
}

const PreCustomCanvas = ({ background = "#555555", playerSpawn, children }: CustomCanvasProps) => {
  const { physicsDebug } = useDevMode();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <color attach="background" args={[background]} />
      <SceneRender />
      <Overlay />
      <Physics gravity={[0, -100, 0]} debug={physicsDebug}>
        {children}
        <Player spawnPosition={playerSpawn} />
      </Physics>
    </>
  );
};

/** PreCustomCanvas needs PortalContext, so wrap it */
const PreCustomCanvasWithPortal = ({ background, playerSpawn, children }: CustomCanvasProps) => (
  <PortalContextProvider>
    <PreCustomCanvas background={background} playerSpawn={playerSpawn}>
      {children}
    </PreCustomCanvas>
  </PortalContextProvider>
);

/** The game canvas. The active world (<GlitchCityWorld/>, <HomeWorld/>) is
 *  passed as children by the route in index.tsx. */
export const CustomCanvas = ({ background = "#555555", playerSpawn, children }: CustomCanvasProps) => {
  const defaultCanvasProps = {
    style: { background },
  };

  const mergedCanvasProps = { ...defaultCanvasProps };

  return (
    <Canvas {...mergedCanvasProps}>
      <GameContextProvider>
        <DayNightProvider>
          <PreCustomCanvasWithPortal background={background} playerSpawn={playerSpawn}>
            {children}
          </PreCustomCanvasWithPortal>
        </DayNightProvider>
      </GameContextProvider>
    </Canvas>
  );
};
