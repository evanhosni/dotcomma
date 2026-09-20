import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect } from "react";
import { useDevContext } from "../context/DevContext";
import { GameContextProvider } from "../context/GameContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { LocalPlayerSync } from "../net/players/LocalPlayerSync";
import { RemotePlayers } from "../net/players/RemotePlayers";
import { DayNightProvider } from "../lighting/DayNightContext";
import { initCursor } from "../utils/cursor/cursor";
import { traceSpan } from "../utils/spikeTrace";
import { shouldPresentThisFrame, isMainRenderFrame } from "../vfx/frameCap";

/** Non-zero useFrame priorities disable R3F's auto-render, so this renders
 *  explicitly. The FPS-cap decision runs ONCE per tick at -10, before every
 *  other hook; off-cadence ticks skip gl.render only (the rAF loop still runs). */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    (window as any).__game = { gl, scene, camera }; // console/debug access only
  }, [gl, scene, camera]);
  useFrame(() => {
    shouldPresentThisFrame();
  }, -10);
  useFrame(() => {
    // A spike INSIDE this span is GPU/driver work; outside it is main-thread JS.
    if (isMainRenderFrame()) traceSpan("render", () => gl.render(scene, camera));
  }, 2);
  return null;
};

// Do NOT reintroduce a post-load scene-wide gl.compile here: it was itself a
// large synchronous hitch tens of seconds into play (see CLAUDE.md).

const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { physicsDebug } = useDevContext();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <SceneRender />
      <Overlay />
      {/* interpolate={false} + timeStep="vary": no dynamic bodies; the fixed 1/60 accumulator
          drove kinematic bodies at 60/fps of their speed above 60fps (see CLAUDE.md). */}
      <Physics gravity={[0, -100, 0]} debug={physicsDebug} interpolate={false} timeStep="vary">
        {children}
        <Player />
      </Physics>
      <LocalPlayerSync />
      <RemotePlayers />
    </>
  );
};

// R3F's defaults (dpr 2 + MSAA + alpha) quadrupled the fragment budget of the
// full-screen terrain shader for a quantized low-poly look. MAX_DPR is the one
// knob to raise if the picture reads soft.
const MAX_DPR = 1.5;
const GL_PROPS = { antialias: false, alpha: false, stencil: false, depth: true, powerPreference: "high-performance" as const };

/** THE canvas — mounted ONCE for the life of the page; domains swap inside it (see CLAUDE.md). */
export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  return (
    // Black avoids a gray flash before the first frame (alpha: false, so CSS never shows otherwise).
    <Canvas style={{ background: "#000000" }} dpr={[1, MAX_DPR]} gl={GL_PROPS}>
      <GameContextProvider>
        <DayNightProvider>
          <PreCustomCanvas>{children}</PreCustomCanvas>
        </DayNightProvider>
      </GameContextProvider>
    </Canvas>
  );
};
