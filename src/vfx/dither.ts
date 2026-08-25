/**
 * Screen-space hash dither — the ±0.5/255 noise every slow gradient in the
 * game adds before 8-bit output (terrain night dim, sky gradient, city-light
 * aura alpha). One GLSL line, one place; `target` is the expression to nudge
 * (e.g. "gl_FragColor.rgb", "color", "diffuseColor.a").
 */
export const ditherGLSL = (target: string): string =>
  `${target} += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;`;
