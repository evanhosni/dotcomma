import { ARM } from "./enums";
import type { Arm } from "./types";

/** Each arm's bones in the beeble rig (beeble.glb's "upper arm.R" etc., as three names them). Blender's bones
 *  run along their own +y: from the shoulder joint to the elbow, the elbow to the hand. */
export const ARM_BONES: Readonly<Record<Arm, { upper: string; lower: string }>> = {
  [ARM.RIGHT]: { upper: "upper_armR", lower: "lower_armR" },
  [ARM.LEFT]: { upper: "upper_armL", lower: "lower_armL" },
};

/** How long the arms take to come up into a hold, or back down to the animation (s). */
export const HOLD_BLEND_SECONDS = 0.18;
/** A one-armed AIM points along the look at a point this far off (u): parallel to it, to the eye. */
export const AIM_DISTANCE = 100;
/** A two-armed AIM's hands meet this far before the chest, unless the spec says (u). */
export const DEFAULT_REACH = 0.55;
