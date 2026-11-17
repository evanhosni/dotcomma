// cells per side → 1536u of coverage

/** Every glow color. A head's `color` is an index into this list (stored as index + 1 in the
 *  texel's w), and the shader's color selection is generated from it — add a color here. */
export const LAMP_COLORS = [
  { name: "warm", rgb: [1.0, 0.82, 0.45] }, // street lamps
  { name: "red", rgb: [1.0, 0.16, 0.1] },
  { name: "yellow", rgb: [1.0, 0.72, 0.1] },
  { name: "green", rgb: [0.15, 1.0, 0.4] },
] as const;

export type LampColorName = (typeof LAMP_COLORS)[number]["name"];
export const lampColorIndex = (name: LampColorName): number => LAMP_COLORS.findIndex((c) => c.name === name);

export const LAMP_COLOR_WARM = lampColorIndex("warm");
export const LAMP_COLOR_RED = lampColorIndex("red");
export const LAMP_COLOR_YELLOW = lampColorIndex("yellow");
export const LAMP_COLOR_GREEN = lampColorIndex("green");
