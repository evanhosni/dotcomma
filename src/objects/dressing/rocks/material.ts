import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../../lighting/dayNight";
import { _material } from "../../../utils/material";
import { ditherGLSL } from "../../../vfx/dither";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../../../world/shaders/chunkProjection";
import commonShader from "../../../world/shaders/common.glsl";
import { glslFloat, TERRAIN_TEXTURE_TILE, WORLD_WRAP } from "../../../world/shaders/constants";
import { ROCK_SHADE_DARK, ROCK_SHADE_LIGHT } from "./spec";

/** The rock look (rocks/ and waterfall-boulders/ both draw with it): the mountain wall's rock under the
 *  terrain's own light, each rock shaded a little lighter or darker, snow on the up-facing faces of a rock
 *  whose biome has snow. */

/** The mountain wall's texture (the mountain biome's `rocktexture`), triplanar on the wrapped position. */
const ROCK_TEXTURE = "dirt.png";

export const createRockMaterial = (): THREE.ShaderMaterial => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...CHUNK_PROJECTION_UNIFORMS,
      rocktexture: { value: null as THREE.Texture | null },
      uShadeDark: { value: new THREE.Color(ROCK_SHADE_DARK) },
      uShadeLight: { value: new THREE.Color(ROCK_SHADE_LIGHT) },
      uNightBlend: NIGHT_BLEND_UNIFORM,
    },
    defines: { WORLD_WRAP: glslFloat(WORLD_WRAP), TEXTURE_TILE: glslFloat(TERRAIN_TEXTURE_TILE) },
    vertexShader: /* glsl */ `
      attribute float shade;
      attribute float snow;
      varying float vShade;
      varying float vSnow;
      ${CHUNK_PROJECTION_GLSL}
      void main() {
        vShade = shade;
        vSnow = snow;
        gl_Position = projectChunkLocal(position, normal);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D rocktexture;
      uniform vec3 uShadeDark;
      uniform vec3 uShadeLight;
      uniform float uNightBlend;
      varying float vShade;
      varying float vSnow;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosWrapped;
      ${commonShader}
      void main() {
        vec3 n = normalize(vWorldNormal);
        // The mountain wall's rock: the terrain's texture, triplanar on the wrapped world position, tinted.
        vec3 rock = triplanarSample(rocktexture, vWorldPosWrapped, n, 1.0 / TEXTURE_TILE).rgb * vec3(0.62, 0.62, 0.66);
        // Each rock a little lighter or darker than the wall: its shade over the middle of the shade range.
        rock *= mix(uShadeDark, uShadeLight, vShade) / mix(uShadeDark, uShadeLight, 0.5);
        // Snow on the up-facing faces of a rock whose biome has snow; none on a boulder in a waterfall.
        vec3 col = mix(rock, vec3(0.9, 0.93, 0.97), smoothstep(0.55, 0.8, n.y) * vSnow);
        col *= 0.6 + 0.4 * fakeSunLight(n);
        ${nightDimGLSL("col")}
        ${ditherGLSL("col")}
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  _material
    .loadTextures([ROCK_TEXTURE])
    .then(([texture]) => {
      material.uniforms.rocktexture.value = texture;
    })
    .catch((e) => console.error("rock texture failed to load:", e));
  return material;
};
