

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

export const getMainRenderFpsCap = (): number => fpsCap;

let backgroundTick = false;
/** Set around a frame BackgroundLoop drives while rAF is stopped: it simulates but presents nothing. */
export const setBackgroundTick = (on: boolean): void => {
  backgroundTick = on;
};

/** Call exactly once per rAF tick, before any render-producing useFrame. */
export const shouldPresentThisFrame = (): boolean => {
  if (backgroundTick) {
    renderThisFrame = false;
    return false;
  }
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

/** Screen pixels per rendered pixel (≤ 1 = off). Drawn by lowering the canvas's pixel ratio and letting the
 *  browser upscale with hard edges (PixelationDriver): a post-process pass fought CustomCanvas's own render
 *  loop (every frame drawn twice, every program relinked, ~2 fps) and cost fill rate instead of saving it. */
export let pixelation = 0;
const pixelationListeners = new Set<() => void>();
export const subscribePixelation = (fn: () => void): (() => void) => {
  pixelationListeners.add(fn);
  return () => {
    pixelationListeners.delete(fn);
  };
};
export const getPixelation = (): number => pixelation;
/** The domain's prop sets it on mount, devmode live (vfx/registry.ts). */
export const setPixelation = (granularity: number): void => {
  pixelation = granularity;
  pixelationListeners.forEach((fn) => fn());
};
