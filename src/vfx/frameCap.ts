/**
 * Main-render FPS cap.
 *
 * Caps ONLY the presented frame — the explicit `gl.render` in SceneRender
 * (and any render-to-texture pass feeding it). The rAF loop itself keeps
 * running at display rate, so every `useFrame` consumer (player physics, NPC
 * state machines, spawn batching, timers — all dt-based) is completely
 * unaffected; on a skipped frame the previous image simply stays on screen.
 * Rationale: a steady 60 reads smoother than 100 with dips — capping keeps
 * GPU/render headroom in reserve so load spikes land below the cap instead of
 * showing up as judder.
 *
 * Configured via <PostProcessing fpsCap={60}> (0/unset = uncapped).
 *
 * Pacing: phase-keeping accumulator (`nextRenderAt += interval`) so the
 * long-run average is exactly the cap, with a small early-tolerance so vsync
 * jitter on an exact-multiple display (60 cap on 120Hz) can't push a tick
 * fractionally past the deadline and stutter to every 3rd vsync. After a
 * stall the deadline resyncs instead of bursting catch-up frames.
 */

let capFps = 0; // 0 = uncapped
let nextRenderAt = 0; // performance.now() deadline for the next presented frame
let renderThisFrame = true;

export const setMainRenderFpsCap = (fps: number | undefined): void => {
  capFps = fps && fps > 0 ? fps : 0;
  nextRenderAt = 0;
  renderThisFrame = true;
};

/** Decides whether THIS rAF tick presents a frame. Called exactly once per
 *  tick, from the frame-cap gate (before any render-producing useFrame). */
export const consumeMainRenderFrame = (): boolean => {
  if (capFps <= 0) {
    renderThisFrame = true;
    return true;
  }
  const interval = 1000 / capFps;
  const now = performance.now();
  if (now < nextRenderAt - interval * 0.1) {
    renderThisFrame = false;
    return false;
  }
  nextRenderAt += interval;
  // Fell a whole interval behind (tab was hidden, a long frame) — resync the
  // phase rather than rendering back-to-back frames to "catch up".
  if (nextRenderAt <= now) nextRenderAt = now + interval * 0.5;
  renderThisFrame = true;
  return true;
};

/** True when the current rAF tick will present a frame. Render-to-texture
 *  passes that only exist to feed the main render should consult this so
 *  they don't burn GPU on frames nobody will see. Everything gameplay-rated
 *  (physics, animation timing) must NOT gate on it. */
export const isMainRenderFrame = (): boolean => renderThisFrame;
