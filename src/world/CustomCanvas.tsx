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
import { traceSpan } from "../utils/spikeTrace";
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
  useEffect(() => {
    // Console/debug access to the live renderer (perf diagnosis: draw-call
    // counts, frustum-flag audits, scripted camera moves). Not used by game code.
    (window as any).__game = { gl, scene, camera };
  }, [gl, scene, camera]);
  useFrame(() => {
    consumeMainRenderFrame();
  }, -10);
  useFrame(() => {
    // traceSpan: a lag spike INSIDE this span is GPU/driver work (first-draw
    // buffer uploads, shader links); outside it is main-thread JS.
    if (isMainRenderFrame()) traceSpan("render", () => gl.render(scene, camera));
  }, 2);
  return null;
};

// NOTE: a post-load scene-wide gl.compile pass ("PrecompileStreamedContent")
// used to live here, firing at +3s/+12s after terrain_loaded. It was REMOVED:
// per-mount warm draws (uploadOnFirstDraw + GameObject/DayNightCycle warm
// frames) now compile every program and upload every buffer at mount time,
// staggered — while the scene-wide pass was itself a large SYNCHRONOUS hitch
// tens of seconds into play (it read as "the first night cycle lag spike").
// Do not reintroduce a whole-scene compile after content has streamed in.

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
