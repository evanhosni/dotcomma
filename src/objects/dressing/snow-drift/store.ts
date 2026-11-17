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
import * as THREE from "three";
import { TRAIL_TEXELS, NEVER, UPLOAD_INTERVAL_FRAMES, TRAIL_WINDOW, STAMP_RADIUS, TRAIL_TEXEL, TRAIL_LIFE_SECONDS, STAMP_SPACING } from "./constants";

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
