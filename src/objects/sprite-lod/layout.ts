/** Floats a look's describer fills per instance. */
export const SPRITE_DATA_FLOATS = 28;
/** The prefix of them that reaches the fragment stage: varyings are scarce. */
export const FRAGMENT_DATA_FLOATS = 16;

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
const UNIT_STEPS = 4095;
const UNIT_RADIX = UNIT_STEPS + 1;

/** Two values in [0, 1] in one float. */
export const packUnitPair = (high: number, low: number): number =>
  Math.round(Math.min(1, Math.max(0, high)) * UNIT_STEPS) * UNIT_RADIX + Math.round(Math.min(1, Math.max(0, low)) * UNIT_STEPS);

export const unpackUnitPair = (packed: number): [number, number] => [
  Math.floor(packed / UNIT_RADIX) / UNIT_STEPS,
  (packed % UNIT_RADIX) / UNIT_STEPS,
];

/** An sRGB hex color, 8 bits per channel, exact in float32. */
export const packColor = (hex: number): number => hex & 0xffffff;

/** The unpacking side of packUnitPair/packColor; colors come back LINEAR, like a baked vertex color. */
export const SPRITE_UNPACK_GLSL = /* glsl */ `
  float spriteUnitPairHigh(float packed) { return floor(packed / ${UNIT_RADIX}.0) / ${UNIT_STEPS}.0; }
  float spriteUnitPairLow(float packed) { return mod(packed, ${UNIT_RADIX}.0) / ${UNIT_STEPS}.0; }
  vec3 spriteUnpackColor(float packed) {
    vec3 srgb = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
    return mix(srgb / 12.92, pow((srgb + 0.055) / 1.055, vec3(2.4)), step(0.04045, srgb));
  }
`;
