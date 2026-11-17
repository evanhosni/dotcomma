import { normalize } from "../utils";

export const WALL_THICKNESS = 0.24;
export const RAMP_THICKNESS = 0.25; // solid floor at each end of the run
/** Shaft inset from the BSP domain edges, so ramp faces never sit flush against the shell. */
export const RAMP_MARGIN = 0.3; // steepest allowed fit (≈39.3°) before giving up on stories; 40° is SLOPE_SLIDE_ANGLE
export const DOORWAY_WIDTH = 2.4; // interior room-to-room openings
export const MIN_ROOM_DIM = 6; // rooms below 2× this never split again
export const LIGHT_PANEL_SPACING = 5.5;
/** Ceiling light panel [x, z] size. */
export const LIGHT_PANEL_SIZE: [number, number] = [1.4, 2.8];
/** Clearance between a panel's corners and the shell's inner surface: a corner past it pokes through the shell
 *  (a house's is only SHELL_INSET thick). */
export const LIGHT_PANEL_WALL_CLEARANCE = 0.3;
/** Room area (u²) each dome light covers. */
export const DOME_LIGHT_AREA = 60;
export const CHILD_SLOT_COUNT = 32;
/** sRGB luminance bounds of the derived interior wall color: the interior is UNLIT, so a near-white
 *  exterior band made rooms glare (and the ceiling, 1.3× brighter, clipped to white). */
export const INTERIOR_WALL_LUMINANCE: [number, number] = [0.28, 0.46];
/** Bounds every interior surface color (overrides included) is clamped into. */
export const INTERIOR_LUMINANCE: [number, number] = [0.1, 0.56];

export const WALL_OBS_MARGIN = WALL_THICKNESS / 2 + 0.25;
export const DOOR_CLEARANCE = DOORWAY_WIDTH / 2 + WALL_THICKNESS / 2 + 0.5;
export const MIN_SIDE = 3.2;

export const LIGHT_PANEL_COLOR = 0xfff7d6;
/** Warmer than the fluorescent panels: a home's bulbs. */
export const DOME_LIGHT_COLOR = 0xffe2b0;
export const DOME_LIGHT_RADIUS = 0.55;

export const DOME_RIM_SHADE = 0.7;

/** Baked wrap-lambert: the interior renders unlit, so this is what makes same-color planes read as
 *  separate. */
export const INTERIOR_LIGHT_DIR = normalize([0.45, 0.8, 0.3]);
