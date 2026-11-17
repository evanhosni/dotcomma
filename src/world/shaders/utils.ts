export const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
