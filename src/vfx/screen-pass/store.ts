import type { LiquidLook, CameraWaterColors } from "./types";

/**
 * DEEP DREAM: Google's actual technique — gradient ascent on the image to excite a layer of a trained
 * image network (MobileNet v1 here, on a worker: vfx/screen-pass/deep-dream/deepDream.worker.ts) — made progressive. A dream takes
 * dozens of steps; a frame has time for none. So the dream ACCUMULATES: each worker request starts from
 * the previous dream, reprojected onto the current view through the depth buffer and the two cameras,
 * blended with a little of the fresh scene, and takes a couple more steps. Patterns grow over a second
 * or two and stay stuck to the world while the camera moves.
 *
 * The worker's answer lags the frame; that is fine, because the dream carries the camera it was taken
 * from and every frame reprojects it again. Reprojection reads the depth of what is on screen NOW, so
 * newly uncovered surfaces show the scene until the next step dreams on them.
 *
 * The dream is taken OVERSCANNED (wider than the screen; the off-screen part carried on from the previous
 * dream), its alpha says where it holds a dream, and its border fades within that off-screen margin: a
 * still camera shows the dream at full strength to the screen's edges, and a quick turn reveals a soft
 * edge a little later, never the hard rectangle of the view it was taken from.
 */

/** Live strength (0–1): how much of the dream is shown. 0 = off, nothing runs. */
export const DEEP_DREAM = { strength: 0 };

/** Live strength (0–1): <PostProcessing dream> sets it, devmode's slider drives it (vfx/registry.ts). */
export const DREAM = { strength: 0 };

export const isDreaming = (): boolean => DREAM.strength > 0;

/** Live values: <PostProcessing trace> sets the strength, devmode's sliders drive both (vfx/registry.ts). */
export const TRACE = { strength: 0, interval: 0.05 };

export const isTracing = (): boolean => TRACE.strength > 0;

export let cameraWaterDepth = 0;

export let cameraLook: LiquidLook = "water";
export let cameraColors: CameraWaterColors | null = null;

/** How far the camera is under a liquid surface (≤ 0 = above it), which liquid, and for water the colours
 *  of the body it is in (none: the base's). The Player writes it every frame. */
export const setCameraWaterDepth = (depth: number, look: LiquidLook = "water", colors: CameraWaterColors | null = null): void => {
  cameraWaterDepth = depth > 0 ? depth : 0;
  cameraLook = look;
  cameraColors = colors;
};

export const isCameraUnderwater = (): boolean => cameraWaterDepth > 0;

/** Devmode's live mixes over every liquid's fog density and blur (vfx/registry.ts); 1 = as designed. */
export const UNDERWATER_MIX = { fog: 1, blur: 1 };

/** Live values: <PostProcessing scan> sets the strength, devmode's sliders drive all of them
 *  (vfx/registry.ts). `grade` is how far the picture is pulled onto the phosphor palette, `contour` the
 *  detected-contour brightness, `raster` the scanline depth. */
export const SCAN = { strength: 0, grade: 0.82, contour: 0.9, raster: 0.22, vignette: 0.55 };

export const isScanning = (): boolean => SCAN.strength > 0;

/** Live values: <PostProcessing inspect> sets the strength, devmode's sliders drive all of them
 *  (vfx/registry.ts). `dash` is 0 = solid outlines → 1 = fully dashed, `gridPx` the layout grid's cell in
 *  screen pixels (0 = off), `pickRadius` how far from the crosshair the selection reaches, in screen heights. */
export const INSPECT = { strength: 0, dash: 0.75, gridPx: 72, pickRadius: 0.22 };

export const isInspecting = (): boolean => INSPECT.strength > 0;
