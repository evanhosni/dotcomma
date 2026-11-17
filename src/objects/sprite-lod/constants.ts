

/** Units past the handoff distance a detailed actor holds on before handing off again. */
export const SPRITE_LOD_HYSTERESIS = 20;

/** Floats a look's describer fills per instance (a multiple of 4: one vec4 attribute and varying each). */
export const SPRITE_DATA_FLOATS = 20;

// One instance: offset xyz (chunk-relative from the worker, rebase-relative once loaded), size (width,
// height), the LOD vec4 (detail, renderDistance, born, a spare slot that keeps the data vec4-aligned),
// then the look's data.
export const INSTANCE_OFFSET = 0;
export const INSTANCE_SIZE = 3;
export const INSTANCE_LOD = 5;
export const INSTANCE_DETAIL = INSTANCE_LOD;
export const INSTANCE_RENDER_DISTANCE = INSTANCE_LOD + 1;
export const INSTANCE_BORN = INSTANCE_LOD + 2;
export const INSTANCE_DATA = INSTANCE_LOD + 4;
export const INSTANCE_FLOATS = INSTANCE_DATA + SPRITE_DATA_FLOATS;

/** 12 bits per value: the high one is scaled by UNIT_RADIX, so the pair fills 24 bits, exact in float32. */
export const UNIT_STEPS = 4095;
export const UNIT_RADIX = UNIT_STEPS + 1;
