import { LAMP_GLOW_MIX } from "../lighting/lamp-glow";
import { WATER_SWELL_MIX } from "../world/water/material";
import { _curvature, _quantization } from "./material";
import { DEEP_DREAM, DREAM, TRACE, UNDERWATER_MIX } from "./screen-pass/store";
import { preloadDeepDream } from "./screen-pass/deep-dream/worker";
import { getMainRenderFpsCap, setMainRenderFpsCap, getPixelation, setPixelation } from "./store";
import type { VfxKnob } from "./types";

/** Devmode's panel can turn any effect on at any moment: the ones with a slow start-up begin it as the panel
 *  is shown (menus/overlay/DevOverlay.tsx), never for a visitor who cannot reach them. */
export const prepareVfxKnobs = (): void => preloadDeepDream();

/** The curvature as its drop 1000u from the camera (vfx/material.ts: K·d² past the flat zone). */
const CURVE_PROBE = 1000;
const curveRun = (): number => Math.max(1, CURVE_PROBE - _curvature.uniforms.uCurveStart.value) ** 2;

export const VFX_KNOBS: readonly VfxKnob[] = [
  { group: "screen", label: "fps cap (0 = off)", min: 0, max: 240, step: 5, get: getMainRenderFpsCap, set: setMainRenderFpsCap },
  { group: "screen", label: "pixelation (px)", min: 1, max: 16, step: 1, get: () => Math.max(1, getPixelation()), set: setPixelation },
  { group: "screen", label: "dream", min: 0, max: 1, step: 0.01, get: () => DREAM.strength, set: (v) => (DREAM.strength = v) },
  { group: "screen", label: "deep dream", min: 0, max: 1, step: 0.01, get: () => DEEP_DREAM.strength, set: (v) => (DEEP_DREAM.strength = v) },
  { group: "screen", label: "trace", min: 0, max: 1, step: 0.01, get: () => TRACE.strength, set: (v) => (TRACE.strength = v) },
  { group: "screen", label: "trace stamp interval (s)", min: 0, max: 0.5, step: 0.01, get: () => TRACE.interval, set: (v) => (TRACE.interval = v) },
  {
    group: "geometry",
    label: "quantization (u)",
    min: 0,
    max: 0.5,
    step: 0.005,
    get: () => _quantization.uniforms.uGridSize.value,
    set: (v) => _quantization.setGridSize(v),
  },
  {
    group: "geometry",
    label: "quantization far start (u)",
    min: 0,
    max: 3000,
    step: 50,
    get: () => _quantization.uniforms.uGridGrowth.value.x,
    set: (v) => _quantization.setGridGrowth({ start: v }),
  },
  {
    group: "geometry",
    label: "quantization far size (u @1km past)",
    min: 0,
    max: 60,
    step: 0.5,
    get: () => _quantization.uniforms.uGridGrowth.value.y,
    set: (v) => _quantization.setGridGrowth({ size: v }),
  },
  {
    group: "geometry",
    label: "quantization far power",
    min: 1,
    max: 4,
    step: 0.1,
    get: () => _quantization.uniforms.uGridGrowth.value.z,
    set: (v) => _quantization.setGridGrowth({ power: v }),
  },
  {
    group: "geometry",
    label: "curvature (drop @1km)",
    min: 0,
    max: 200,
    step: 1,
    get: () => _curvature.uniforms.uCurveK.value * curveRun(),
    set: (v) => (_curvature.uniforms.uCurveK.value = v / curveRun()),
  },
  {
    group: "geometry",
    label: "curvature flat zone (u)",
    min: 0,
    max: 500,
    step: 5,
    get: () => _curvature.uniforms.uCurveStart.value,
    set: (v) => (_curvature.uniforms.uCurveStart.value = v),
  },
  { group: "lighting", label: "lamp glow", min: 0, max: 3, step: 0.05, get: () => LAMP_GLOW_MIX.value, set: (v) => (LAMP_GLOW_MIX.value = v) },
  { group: "water", label: "water swell", min: 0, max: 5, step: 0.05, get: () => WATER_SWELL_MIX.value, set: (v) => (WATER_SWELL_MIX.value = v) },
  { group: "water", label: "underwater fog", min: 0, max: 3, step: 0.05, get: () => UNDERWATER_MIX.fog, set: (v) => (UNDERWATER_MIX.fog = v) },
  { group: "water", label: "underwater blur", min: 0, max: 3, step: 0.05, get: () => UNDERWATER_MIX.blur, set: (v) => (UNDERWATER_MIX.blur = v) },
];
