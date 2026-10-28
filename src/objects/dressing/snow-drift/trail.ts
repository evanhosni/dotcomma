import * as THREE from "three";

/**
 * THE SNOW TRAIL: where capsules walked through the snow, as a world-aligned stamp map the near
 * sheet's vertex shader dents by (snowMaterial.ts). One RGBA float texture of TRAIL_TEXELS² texels
 * at TRAIL_TEXEL each, addressed TOROIDALLY by the world position (texel = floor(x / TRAIL_TEXEL) mod
 * TRAIL_TEXELS): nothing scrolls as the player moves, and a texel far behind is simply overwritten
 * when the walk comes round to it. Each texel holds the stamp's TIME, the 128u TILE it was stamped in
 * (a texel aliases every TRAIL_WINDOW units; the shader dents only where the tile matches, so a trail
 * 128u behind never shows 128u ahead) and its strength. Recovery is the shader's: a dent fades out
 * over TRAIL_LIFE_SECONDS from the stamp's time against one clock uniform, so stamping writes a few
 * texels and nothing decays on the CPU. Seen by this client only (every client stamps whoever it sees).
 */

export const TRAIL_TEXELS = 256;
export const TRAIL_TEXEL = 0.5;
export const TRAIL_WINDOW = TRAIL_TEXELS * TRAIL_TEXEL;
/** A dent is gone this long after its stamp. */
export const TRAIL_LIFE_SECONDS = 20;
/** A stamp's radius (a capsule's footprint and the snow it pushes aside), real units. */
const STAMP_RADIUS = 0.85;
/** Frames between texture uploads while stamps land (a whole 1MB texture goes up per upload). */
const UPLOAD_INTERVAL_FRAMES = 3;
const NEVER = -1e9;

const data = new Float32Array(TRAIL_TEXELS * TRAIL_TEXELS * 4);
for (let i = 0; i < data.length; i += 4) data[i] = NEVER;
const texture = new THREE.DataTexture(data, TRAIL_TEXELS, TRAIL_TEXELS, THREE.RGBAFormat, THREE.FloatType);
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
texture.generateMipmaps = false;
texture.needsUpdate = true;

/** The sheet shader's uniforms: the stamp map and the clock its ages are measured against. */
export const SNOW_TRAIL_UNIFORMS = {
  uSnowTrail: { value: texture },
  uTrailNow: { value: 0 },
};

let now = 0;
let dirty = false;
let framesSinceUpload = 0;

/** Once per frame (the snow sheet's frame loop): the clock, and the upload of any new stamps. */
export const tickSnowTrail = (elapsedSeconds: number): void => {
  now = elapsedSeconds;
  SNOW_TRAIL_UNIFORMS.uTrailNow.value = now;
  if (!dirty) return;
  if (++framesSinceUpload < UPLOAD_INTERVAL_FRAMES) return;
  texture.needsUpdate = true;
  dirty = false;
  framesSinceUpload = 0;
};

const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** A capsule stood at (x, z): the texels within STAMP_RADIUS take this stamp (its strength falling off
 *  to the edge, never under what a live stamp there still holds). */
/** Stamps closer than this along a walk are skipped (the stamp map's texel is 0.5u). */
const STAMP_SPACING = 0.7;

export const stampSnowTrail = (x: number, z: number): void => {
  const tileX = Math.floor(x / TRAIL_WINDOW);
  const tileZ = Math.floor(z / TRAIL_WINDOW);
  const r = STAMP_RADIUS;
  const t0 = Math.floor((x - r) / TRAIL_TEXEL);
  const t1 = Math.floor((x + r) / TRAIL_TEXEL);
  const s0 = Math.floor((z - r) / TRAIL_TEXEL);
  const s1 = Math.floor((z + r) / TRAIL_TEXEL);
  for (let tz = s0; tz <= s1; tz++) {
    const cz = (tz + 0.5) * TRAIL_TEXEL;
    for (let tx = t0; tx <= t1; tx++) {
      const cx = (tx + 0.5) * TRAIL_TEXEL;
      const d2 = ((cx - x) * (cx - x) + (cz - z) * (cz - z)) / (r * r);
      if (d2 >= 1) continue;
      const strength = 1 - d2 * d2;
      const i = (mod(tz, TRAIL_TEXELS) * TRAIL_TEXELS + mod(tx, TRAIL_TEXELS)) * 4;
      // A texel of this tile still denting keeps the deeper of the two, re-timed to now.
      const held = data[i + 1] === tileX && data[i + 2] === tileZ ? data[i + 3] * Math.max(0, 1 - (now - data[i]) / TRAIL_LIFE_SECONDS) : 0;
      data[i] = now;
      data[i + 1] = tileX;
      data[i + 2] = tileZ;
      data[i + 3] = Math.max(strength, held);
    }
  }
  dirty = true;
};

/** The vertex-stage read: the dent (0–1) at an ABSOLUTE world position, bilinear over the four
 *  nearest texels, each counted only where its tile is this position's and its stamp still lives.
 *  Needs the two uniforms declared by SNOW_TRAIL_UNIFORMS_GLSL. */
export const SNOW_TRAIL_UNIFORMS_GLSL = /* glsl */ `
  uniform sampler2D uSnowTrail;
  uniform float uTrailNow;
`;
export const SNOW_TRAIL_GLSL = /* glsl */ `
  float snowTrailTexel(vec2 texel, vec2 tile) {
    vec4 s = texture2D(uSnowTrail, (texel + 0.5) / ${TRAIL_TEXELS.toFixed(1)});
    if (abs(s.y - tile.x) > 0.5 || abs(s.z - tile.y) > 0.5) return 0.0;
    return s.w * (1.0 - smoothstep(0.0, ${TRAIL_LIFE_SECONDS.toFixed(1)}, uTrailNow - s.x));
  }
  float snowTrailDent(vec2 worldXZ) {
    vec2 tile = floor(worldXZ / ${TRAIL_WINDOW.toFixed(1)});
    vec2 t = worldXZ / ${TRAIL_TEXEL.toFixed(2)} - 0.5;
    vec2 t0 = floor(t);
    vec2 f = t - t0;
    float a = snowTrailTexel(t0, tile);
    float b = snowTrailTexel(t0 + vec2(1.0, 0.0), tile);
    float c = snowTrailTexel(t0 + vec2(0.0, 1.0), tile);
    float d = snowTrailTexel(t0 + vec2(1.0, 1.0), tile);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

/** A walker's stamps along its path: one every STAMP_SPACING of travel from the last (`last` is the
 *  walker's own, updated here). */
export const stampSnowTrailAlong = (last: { x: number; z: number }, x: number, z: number): void => {
  const dx = x - last.x;
  const dz = z - last.z;
  if (dx * dx + dz * dz < STAMP_SPACING * STAMP_SPACING) return;
  last.x = x;
  last.z = z;
  stampSnowTrail(x, z);
};
