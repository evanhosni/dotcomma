/** ±0.5/255 screen-space hash dither for slow gradients before 8-bit output; `target` is an rgb or alpha expression. */
export const ditherGLSL = (target: string): string =>
  `${target} += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;`;
