import { WallSide } from "../types";

export const SIDES: WallSide[] = ["+z", "-z", "+x", "-x"];

export const GRAYSCALE = [0x2e3134, 0x45484c, 0x5a5e63, 0x6f7378, 0x84888d, 0x9aa0a5, 0xb4b9be, 0xd0d4d8];
export const ACCENTS = [0x5b8fc7, 0x6f5fb5, 0x8d7ec9, 0x9c3f3f, 0xb0632f, 0x8a5a33, 0x3f7f86];
export const DEFAULT_WINDOW_SIZE: [number, number] = [2.4, 4.4];
export const GLASS_COLORS = [0x9fd8ec, 0x8ec7de, 0xaad4ea];
export const PIPE_COLORS = [0x6b4a2f, 0x8a8f96, 0x3c4046];
export const DOOR_BROWNS = [0x4a352a, 0x5a4030, 0x6b4a2f, 0x7a5a3a, 0x8a6a4a];
/** Minimum sRGB-luminance gap between a door and the walls around it. */
export const DOOR_CONTRAST = 0.15;
export const HANDLE_METALS = [0xc9a54a, 0xb08d3c, 0x9ea3a8, 0x2c2e31];
export const ROOF_SHINGLES = [0x3b3f45, 0x4a3b35, 0x5c3a2e, 0x7a3a2c, 0x4d5544, 0x2f3338];

export const WINDOW_ROW_SPACING = 6.0;
