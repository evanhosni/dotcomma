/**
 * Constants shared between the terrain shaders (raw .glsl assets, which
 * cannot import TypeScript) and the code that composes them. They reach the
 * GLSL as `#define`s through the terrain ShaderMaterial's `defines`
 * (world/terrain/material.ts), so a value is spelled exactly once.
 */

/** Chunk-origin wrap period for vWorldPos — a common multiple of every
 *  world-space period downstream (26.25u texture tile ×160, 75u sidewalk
 *  tile ×56, 200u fbm cell ×21) and of both quantization grids (0.025
 *  ×168000, 0.2 ×21000). Anything new that reads vWorldPos with a
 *  world-space period must divide this, or it seams every WORLD_WRAP units.
 *  See the precision note in vertex.glsl / CLAUDE.md. */
export const WORLD_WRAP = 4200;

/** Format a number as a GLSL float literal for a `#define`. */
export const glslFloat = (v: number): string => (Number.isInteger(v) ? `${v}.0` : `${v}`);
