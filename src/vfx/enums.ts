/** One live VFX knob for devmode's "vfx" sliders (menus/overlay/DevOverlay.tsx). It reads and writes the
 *  effect's live value, so the slider always shows what is on screen; nothing is saved, and a domain
 *  switch puts back what that domain's <PostProcessing> sets. */
/** The devmode list's sections, in display order: each knob is listed under its group. */
export const VFX_GROUPS = ["screen", "geometry", "lighting", "water"] as const;
