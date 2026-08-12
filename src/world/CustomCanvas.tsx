import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect } from "react";
import { useDevMode } from "../context/DevContext";
import { GameContextProvider, useGameContext } from "../context/GameContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { PortalContextProvider } from "../portals/PortalContext";
import { DayNightProvider } from "../sky/DayNightContext";
import { initCursor } from "../utils/cursor/cursor";
import { consumeMainRenderFrame, isMainRenderFrame } from "../vfx/frameCap";

/** Portal useFrame hooks use non-zero priorities (-1, 1), which disables R3F's
 *  auto-rendering. This component replaces it with an explicit render at the end.
 *
 *  FPS cap (set via <PostProcessing fpsCap>): the whole rAF loop still runs —
 *  physics, state machines, and every dt-based useFrame are untouched — but
 *  gl.render is skipped on off-cadence ticks (the previous frame stays on
 *  screen). The decision is made ONCE per tick at priority -10, BEFORE the
 *  portal RT passes (0.9 / 1) so they can skip frames nobody will see. */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useFrame(() => {
    consumeMainRenderFrame();
  }, -10);
  useFrame(() => {
    if (isMainRenderFrame()) gl.render(scene, camera);
  }, 2);
  return null;
};

/** Post-load shader precompile. DayNightCycle's gl.compile runs at world
 *  mount, BEFORE any streamed content exists — grass chunks, spawned actors,
 *  and dressing mount later, and a material type the player hasn't faced yet
 *  otherwise lazy-compiles+links its program on the exact frame it first
 *  enters the view (expensive under Windows/ANGLE — the same stall class as
 *  the old nightfall hitch, felt as a dip while "just looking around").
 *  Re-compiling shortly after load converts those scattered mid-gameplay
 *  stalls into one controlled hitch while the world is still settling; the
 *  second pass catches late-streaming content. Programs already compiled are
 *  cache hits, so repeat passes only pay for genuinely new programs. */
const PrecompileStreamedContent = () => {
  const { gl, scene, camera } = useThree();
  const { terrain_loaded } = useGameContext();
  useEffect(() => {
    if (!terrain_loaded) return;
    const timers = [3000, 12000].map((ms) => window.setTimeout(() => gl.compile(scene, camera), ms));
    return () => timers.forEach((t) => clearTimeout(t));
  }, [terrain_loaded, gl, scene, camera]);
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
      <PrecompileStreamedContent />
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
