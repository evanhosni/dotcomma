import { LAMP_GLOW_MIX } from "../lighting/lampGlow";
import { WATER_SWELL_MIX } from "../world/water/material";
import { _curvature } from "./curvature";
import { DEEP_DREAM } from "./deep-dream";
import { DREAM } from "./dream";
import { getMainRenderFpsCap, setMainRenderFpsCap } from "./frameCap";
import { getPixelation, setPixelation } from "./PostProcessing";
import { _quantization } from "./quantization";
import { UNDERWATER_MIX } from "./underwater";

/** One live VFX knob for devmode's "vfx" sliders (menus/overlay/DevOverlay.tsx). It reads and writes the
 *  effect's live value, so the slider always shows what is on screen; nothing is saved, and a domain
 *  switch puts back what that domain's <PostProcessing> sets. */
/** The devmode list's sections, in display order: each knob is listed under its group. */
export const VFX_GROUPS = ["screen", "geometry", "lighting", "water"] as const;
export type VfxGroup = (typeof VFX_GROUPS)[number];

export interface VfxKnob {
  group: VfxGroup;
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
  { group: "screen", label: "fps cap (0 = off)", min: 0, max: 240, step: 5, get: getMainRenderFpsCap, set: setMainRenderFpsCap },
  { group: "screen", label: "pixelation (px)", min: 1, max: 16, step: 1, get: () => Math.max(1, getPixelation()), set: setPixelation },
  { group: "screen", label: "dream", min: 0, max: 1, step: 0.01, get: () => DREAM.strength, set: (v) => (DREAM.strength = v) },
  { group: "screen", label: "deep dream", min: 0, max: 1, step: 0.01, get: () => DEEP_DREAM.strength, set: (v) => (DEEP_DREAM.strength = v) },
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
