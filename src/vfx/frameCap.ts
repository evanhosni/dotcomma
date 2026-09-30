// Caps ONLY the presented frame (SceneRender's gl.render); the rAF loop and every dt-based
// useFrame consumer run at display rate. A steady 60 reads smoother than 100 with dips.

let fpsCap = 0; // 0 = uncapped
let nextRenderAt = 0; // performance.now() deadline for the next presented frame
let renderThisFrame = true;

export const setMainRenderFpsCap = (fps: number | undefined): void => {
  fpsCap = fps && fps > 0 ? fps : 0;
  nextRenderAt = 0;
  renderThisFrame = true;
};

/** Call exactly once per rAF tick, before any render-producing useFrame. */
export const shouldPresentThisFrame = (): boolean => {
  if (fpsCap <= 0) {
    renderThisFrame = true;
    return true;
  }
  const interval = 1000 / fpsCap;
  const now = performance.now();
  // 10% early tolerance: vsync jitter on an exact-multiple display (60 cap on 120Hz) would
  // otherwise push a tick fractionally past the deadline and stutter to every 3rd vsync.
  if (now < nextRenderAt - interval * 0.1) {
    renderThisFrame = false;
    return false;
  }
  nextRenderAt += interval;
  // A whole interval behind (hidden tab, long frame): resync instead of bursting catch-up frames.
  if (nextRenderAt <= now) nextRenderAt = now + interval * 0.5;
  renderThisFrame = true;
  return true;
};

/** For render-to-texture passes that only feed the main render. Gameplay code must NOT gate on it. */
export const isMainRenderFrame = (): boolean => renderThisFrame;
