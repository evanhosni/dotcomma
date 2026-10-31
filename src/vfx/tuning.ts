import { LAMP_GLOW_MIX } from "../lighting/lampGlow";
import { WATER_SWELL_MIX } from "../world/water/material";
import { _curvature } from "./curvature";
import { getPixelation, setPixelation } from "./PostProcessing";
import { _quantization } from "./quantization";
import { UNDERWATER_MIX } from "./underwater";

/** One live VFX knob for devmode's "vfx" sliders (menus/overlay/DevOverlay.tsx). It reads and writes the
 *  effect's live value, so the slider always shows what is on screen; nothing is saved, and a domain
 *  switch puts back what that domain's <PostProcessing> sets. */
export interface VfxKnob {
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (value: number) => void;
}

/** The curvature as its drop 1000u from the camera (vfx/curvature.ts: K·d² past the flat zone). */
const CURVE_PROBE = 1000;
const curveRun = (): number => Math.max(1, CURVE_PROBE - _curvature.uniforms.uCurveStart.value) ** 2;

export const VFX_KNOBS: readonly VfxKnob[] = [
  { label: "pixelation (px)", min: 1, max: 16, step: 1, get: () => Math.max(1, getPixelation()), set: setPixelation },
  {
    label: "quantization (u)",
    min: 0,
    max: 0.5,
    step: 0.005,
    get: () => _quantization.uniforms.uGridSize.value,
    set: (v) => _quantization.setGridSize(v),
  },
  {
    label: "curvature (drop @1km)",
    min: 0,
    max: 200,
    step: 1,
    get: () => _curvature.uniforms.uCurveK.value * curveRun(),
    set: (v) => (_curvature.uniforms.uCurveK.value = v / curveRun()),
  },
  {
    label: "curvature flat zone (u)",
    min: 0,
    max: 500,
    step: 5,
    get: () => _curvature.uniforms.uCurveStart.value,
    set: (v) => (_curvature.uniforms.uCurveStart.value = v),
  },
  { label: "lamp glow", min: 0, max: 3, step: 0.05, get: () => LAMP_GLOW_MIX.value, set: (v) => (LAMP_GLOW_MIX.value = v) },
  { label: "water swell", min: 0, max: 5, step: 0.05, get: () => WATER_SWELL_MIX.value, set: (v) => (WATER_SWELL_MIX.value = v) },
  { label: "underwater fog", min: 0, max: 3, step: 0.05, get: () => UNDERWATER_MIX.fog, set: (v) => (UNDERWATER_MIX.fog = v) },
  { label: "underwater blur", min: 0, max: 3, step: 0.05, get: () => UNDERWATER_MIX.blur, set: (v) => (UNDERWATER_MIX.blur = v) },
];
