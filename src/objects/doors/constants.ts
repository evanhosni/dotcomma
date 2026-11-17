import { QUANTIZATION_GRID } from "../../world/constants";

/** Rad, toward +z. */
export const DOOR_OPEN_ANGLE = -1.9;
/** 1/s, exponential ease. */
export const DOOR_SWING_RATE = 4;

/** The leaf overlaps the jamb and header so a closed door never shows a gap. */
export const LEAF_OVERLAP_WIDTH = 0.16;
export const LEAF_OVERLAP_HEIGHT = 0.2;
export const LEAF_THICKNESS = 0.1;
export const LEAF_LIFT = 0.05;
/** The handle: a spindle through the leaf this far in from the free edge, at a third of the height. */
export const HANDLE_INSET = 0.4;
export const HANDLE_HEIGHT_SHARE = 0.33;
export const HANDLE_STANDOFF = 0.16;
export const KNOB_RADIUS = 0.11;
export const LEVER_SIZE: [number, number, number] = [0.42, 0.07, 0.08];
export const LEVER_SETBACK = 0.17;
export const SPINDLE_RADIUS = 0.04;
/** ONE quantization step: the leaf's edge and the jamb (its top and the lintel) snap to lattice points
 *  exactly a step apart, so the closed door shows a fixed 2.5cm crack. Less, and they can snap onto each
 *  other; more (0.04 before), and the crack is one or two steps by the lattice's phase, 5cm at most. */
export const LEAF_CLEARANCE = QUANTIZATION_GRID;
