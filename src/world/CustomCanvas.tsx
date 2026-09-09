import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { useEffect } from "react";
import { useDevMode } from "../context/DevContext";
import { GameContextProvider } from "../context/GameContext";
import { Overlay } from "../menus/overlay/Overlay";
import { Player } from "../player/Player";
import { LocalPlayerSync } from "../net/LocalPlayerSync";
import { RemotePlayers } from "../net/RemotePlayers";
import { DayNightProvider } from "../lighting/DayNightContext";
import { initCursor } from "../utils/cursor/cursor";
import { traceSpan } from "../utils/spikeTrace";
import { consumeMainRenderFrame, isMainRenderFrame } from "../vfx/frameCap";

/** Several useFrame hooks use non-zero priorities (frame-cap decision at -10,
 *  Player at -3), which disables R3F's auto-rendering. This component replaces
 *  it with an explicit render at the end.
 *
 *  FPS cap (set via <PostProcessing fpsCap>): the whole rAF loop still runs —
 *  physics, state machines, and every dt-based useFrame are untouched — but
 *  gl.render is skipped on off-cadence ticks (the previous frame stays on
 *  screen). The decision is made ONCE per tick at priority -10, BEFORE the
 *  rest of the frame's hooks. */
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
// per-mount warm draws (uploadOnFirstDraw + ModelActor/DayNightCycle warm
// frames) now compile every program and upload every buffer at mount time,
// staggered — while the scene-wide pass was itself a large SYNCHRONOUS hitch
// tens of seconds into play (it read as "the first night cycle lag spike").
// Do not reintroduce a whole-scene compile after content has streamed in.

/** Per-domain scene state (background color, player spawn) is NOT a canvas
 *  prop: the canvas persists across domain switches, so <Domain background
 *  playerSpawn> owns it (world/components/Domain.tsx). */
const PreCustomCanvas = ({ children }: React.PropsWithChildren) => {
  const { physicsDebug } = useDevMode();

  useEffect(() => {
    initCursor();
  }, []);

  return (
    <>
      <SceneRender />
      <Overlay />
      {/* interpolate={false}: r-t-r's default snapshots EVERY rigid body's
          translation+rotation (two wasm calls + three allocations per body,
          a fresh dictionary per step) before each physics step to lerp
          visuals between steps. This scene has ZERO dynamic bodies — every
          body is fixed (terrain, buildings, dressing) or kinematic and
          driven by our own code (player camera, beeble group) — so the
          snapshot buys nothing and scaled with the 500+ bodies in the city,
          on exactly the long frames where the accumulator steps twice. */}
      <Physics gravity={[0, -100, 0]} debug={physicsDebug} interpolate={false}>
        {children}
        <Player />
      </Physics>
      {/* Multiplayer (persistent like the Player): the local intent publisher
          and the remote capsules. No physics bodies, so outside <Physics>. */}
      <LocalPlayerSync />
      <RemotePlayers />
    </>
  );
};

/** THE game canvas — mounted ONCE for the life of the page. The active world
 *  (<GlitchCityDomain/>, <HomeDomain/>) is swapped as children by index.tsx;
 *  the GL context, compiled shader programs, physics world, Player, contexts
 *  and overlays all survive a domain switch. (Remounting the canvas per domain
 *  was the previous design: it force-lost the GL context — logged as
 *  "THREE.WebGLRenderer: Context Lost." — recompiled every shader, and needed
 *  a pointer-lock re-request hack because the locked element was destroyed.) */
/** Framebuffer budget. R3F's defaults are dpr [1, 2] + MSAA + an alpha
 *  buffer: on a 2× display that is FOUR times the fragments of a 1× buffer,
 *  multisampled, for the terrain shader that covers the whole screen. The
 *  art direction is quantized low-poly with a screen-space dither, so MSAA
 *  and dpr 2 buy very little; alpha is never used (the page never shows
 *  through). MAX_DPR is the one knob to raise if the picture reads soft. */
const MAX_DPR = 1.5;
const GL_PROPS = { antialias: false, alpha: false, stencil: false, depth: true, powerPreference: "high-performance" as const };

export const CustomCanvas = ({ children }: React.PropsWithChildren) => {
  return (
    // The CSS background never shows (alpha: false, the scene paints every
    // pixel); black just avoids a gray flash before the first frame.
    <Canvas style={{ background: "#000000" }} dpr={[1, MAX_DPR]} gl={GL_PROPS}>
      <GameContextProvider>
        <DayNightProvider>
          <PreCustomCanvas>{children}</PreCustomCanvas>
        </DayNightProvider>
      </GameContextProvider>
    </Canvas>
  );
};
