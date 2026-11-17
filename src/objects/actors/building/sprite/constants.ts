export const PROFILE_POINTS = 6;
/** Story and window heights are packed as fractions of this (u). */
export const MAX_PACKED_HEIGHT = 16;
/** Window width ÷ height in the sprite's window grid. */
export const WINDOW_ASPECT = 1.15;
/** Column pitch as a multiple of the window width. */
export const WINDOW_COLUMN_PITCH = 2.2;

// The data layout (floats).
export const OUTLINE_OFFSET = 0; // per profile height: [height ÷ box height, width ÷ box width]
export const COLORS_OFFSET = OUTLINE_OFFSET + PROFILE_POINTS; // each height's band color
export const WINDOW_BAND_OFFSET = COLORS_OFFSET + PROFILE_POINTS; // [lowest window bottom, highest top] ÷ box height
export const WINDOW_SIZE_OFFSET = WINDOW_BAND_OFFSET + 1; // [story height, window height] ÷ MAX_PACKED_HEIGHT
export const GLASS_OFFSET = WINDOW_SIZE_OFFSET + 1;
export const WINDOW_MIX_OFFSET = GLASS_OFFSET + 1; // [fraction of grid cells with a window, light chance]
export const PATTERN_SEED_OFFSET = WINDOW_MIX_OFFSET + 1;
