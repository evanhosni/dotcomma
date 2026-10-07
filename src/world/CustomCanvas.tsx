import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect, useMemo } from "react";
import { useDevContext } from "../context/DevContext";
import { GameContextProvider } from "../context/GameContext";
import { StatsOverlay } from "../menus/overlay/StatsOverlay";
import { Player } from "../player/Player";
import { LocalPlayerSync } from "../net/players/LocalPlayerSync";
import { RemotePlayers } from "../net/players/RemotePlayers";
import { LampGlowDriver } from "../lighting/lampGlow";
import { GRAVITY } from "../physics/characterMovement";
import { initCursor } from "../utils/cursor/cursor";
import { traceSpan } from "../utils/spikeTrace";
import { bindProgramCompiler } from "../utils/warmPrograms";
import { shouldPresentThisFrame, isMainRenderFrame } from "../vfx/frameCap";
import { isCameraUnderwater, UnderwaterPass } from "../vfx/underwater";

/** Non-zero useFrame priorities disable R3F's auto-render, so this renders
 *  explicitly. The FPS-cap decision runs ONCE per tick at -10, before every
 *  other hook; off-cadence ticks skip gl.render only (the rAF loop still runs). */
const SceneRender = () => {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    (window as any).__game = { gl, scene, camera }; // console/debug access only
    // A self-updating scene root FORCES updateMatrixWorld through every descendant each frame,
    // matrixWorldAutoUpdate = false included, which would defeat the actors' matrix freezing.
    // The root never moves (~364 → 218µs per scene update in the city).
    scene.updateMatrix();
    scene.matrixAutoUpdate = false;
  }, [gl, scene, camera]);
  // Before any sibling below mounts its content: their program warm-ups compile through it.
  useEffect(() => bindProgramCompiler(gl, camera), [gl, camera]);
  useFrame(() => {
    shouldPresentThisFrame();
  }, -10);
  const underwater = useMemo(() => new UnderwaterPass(), []);
  useEffect(() => {
    underwater.warm(gl);
    return () => underwater.dispose();
  }, [gl, underwater]);
  useFrame(({ clock }) => {
    if (!isMainRenderFrame()) return;
    // A spike INSIDE this span is GPU/driver work; outside it is main-thread JS.
    traceSpan("render", () => {
      if (isCameraUnderwater()) underwater.render(gl, scene, camera, clock.elapsedTime);
      else gl.render(scene, camera);
    });
  }, 2);
  return null;
};

// Do NOT reintroduce a post-load scene-wide gl.compile here: it was itself a
// large synchronous hitch tens of seconds into play (see CLAUDE.md).

const PHYSICS_GRAVITY: [number, number, number] = [0, GRAVITY, 0];

/** Everything that lives as long as the canvas: the render loop, the HUD, the physics world (the domain
 *  and the Player inside it) and the network players. */
const CanvasContents = ({ children }: React.PropsWithChildren) => {
  const { physicsDebug } = useDevContext();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <SceneRender />
      <LampGlowDriver />
      <StatsOverlay />
      {/* interpolate={false} + timeStep="vary": no dynamic bodies; the fixed 1/60 accumulator
          drove kinematic bodies at 60/fps of their speed above 60fps (see CLAUDE.md). */}
      <Physics gravity={PHYSICS_GRAVITY} debug={physicsDebug} interpolate={false} timeStep="vary">
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
        <CanvasContents>{children}</CanvasContents>
      </GameContextProvider>
    </Canvas>
  );
};
