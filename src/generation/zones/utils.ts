/** GLSL smoothstep(0, 1, t) on a raw ratio. */
export const sstep01 = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
};

/** Half-widths are floored at 0.5u: a zero window would make a wall's indicators sum to 0. */
export const resolveHalf = (...widths: (number | undefined)[]): number => {
  for (const w of widths) if (w !== undefined) return Math.max(0.5, w / 2);
  return 0.5;
};
