/** ±0.5/255 screen-space hash dither for slow gradients before 8-bit output; `target` is an rgb or alpha expression. */
export const ditherGLSL = (target: string): string =>
  `${target} += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;`;

/** Screen-door threshold: a 4×4 Bayer matrix at (k + 0.5)/16, so a visibility of 1 never discards and 0 always does. The spawn fade's look (spawnFade.ts). */
export const SCREEN_DOOR_GLSL = /* glsl */ `
  float screenDoorBayer2(vec2 a) { a = mod(floor(a), 2.0); return fract(a.x * 0.5 + a.y * 0.75); }
  float screenDoorThreshold(vec2 fragCoord) {
    return screenDoorBayer2(fragCoord) + screenDoorBayer2(fragCoord * 0.5) * 0.25 + 0.03125;
  }
`;
