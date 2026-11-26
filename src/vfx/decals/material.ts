import * as THREE from "three";
import { prepareActorMaterial } from "../../objects/actors/material";
import { chainMaterialPatch } from "../material";
import { DECAL_SHRINK_SECONDS } from "./constants";
import type { DecalLook } from "./types";

/** The clock every decal material shrinks its decals by (Decals.tsx sets it each frame). */
export const decalTime: THREE.IUniform<number> = { value: 0 };

const HEADER = /* glsl */ `
uniform float uDecalTime;
uniform float uDecalSeconds;
varying vec2 vDecalP;
varying float vDecalSeed;
`;

const VERTEX = /* glsl */ `
attribute vec2 aDecal;
` + HEADER;

/** Shrinks a decal away at the end of its time; hands the shape its quad point and seed. */
const SHRINK = /* glsl */ `
vDecalP = position.xy * 2.0;
vDecalSeed = aDecal.x;
transformed *= clamp((uDecalSeconds - (uDecalTime - aDecal.y)) / ${DECAL_SHRINK_SECONDS.toFixed(1)}, 0.0, 1.0);
`;

const FRAGMENT = HEADER + /* glsl */ `
float decalHash(float n) { return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
/** One lobe of an outline round the decal: k bumps, turned by the seed. */
float decalWave(float a, float seed, float k) { return sin(a * k + decalHash(seed * 7.0 + k) * 6.2832); }
`;

/**
 * A kind of decal's material: a flat quad per decal, its shape cut by the look's GLSL (no texture: every
 * decal its own shape, by its seed), drawn over the surface it lies on (after the opaque world, no depth
 * write, pulled forward by a polygon offset), unlit like the blood in the air. Built on the actor base
 * (prepareActorMaterial: curvature, spawn fade), off the quantization lattice and without lamp glow.
 */
export const decalMaterial = (look: DecalLook): THREE.MeshBasicMaterial => {
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  prepareActorMaterial(material, { skipQuantization: true, skipLampGlow: true });
  const seconds: THREE.IUniform<number> = { value: look.seconds };
  chainMaterialPatch(material, "_decal_" + look.key, (shader) => {
    shader.uniforms.uDecalTime = decalTime;
    shader.uniforms.uDecalSeconds = seconds;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", VERTEX + "void main() {")
      .replace("#include <begin_vertex>", "#include <begin_vertex>" + SHRINK);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", FRAGMENT + "void main() {")
      .replace("#include <color_fragment>", `#include <color_fragment>
{
  vec2 p = vDecalP;
  float seed = vDecalSeed;
  vec4 decalColor = vec4(1.0);
  ${look.shape}
  diffuseColor *= decalColor;
}`);
  });
  return material;
};

/** A square of blood, each its own darkness: the old splats' #6a0008 (in linear colour) at the lightest,
 *  down to 55% of it. */
export const BLOOD_SHAPE = /* glsl */ `
  decalColor = vec4(vec3(0.144, 0.0, 0.0025) * mix(1.0, 0.55, seed), 0.94);
`;

/** A bullet hole: a black core in a jagged, torn ring that fades into the surface, cracks running out of it. */
export const BULLET_HOLE_SHAPE = /* glsl */ `
  float a = atan(p.y, p.x);
  float d = length(p);
  float jag = decalHash(floor((a + 3.1416) / 6.2832 * 11.0) + seed * 31.0) - 0.5;
  float rim = 0.5 + 0.07 * decalWave(a, seed, 4.0) + 0.05 * decalWave(a, seed, 9.0) + 0.1 * jag;
  float core = rim * (0.45 + 0.08 * decalWave(a, seed, 6.0));
  bool crack = false;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float toward = decalHash(seed * 23.0 + fi) * 6.2832 - 3.1416;
    float reach = rim + 0.12 + 0.35 * decalHash(seed * 29.0 + fi);
    float off = abs(mod(a - toward + 3.1416, 6.2832) - 3.1416) * d;
    crack = crack || (d < reach && off < 0.035 * (1.0 - d / reach));
  }
  if (d > rim && !crack) discard;
  if (d < core) decalColor = vec4(0.004, 0.003, 0.003, 1.0);
  else if (d < rim) decalColor = vec4(vec3(0.018, 0.015, 0.013), mix(0.9, 0.35, (d - core) / (rim - core)));
  else decalColor = vec4(vec3(0.01), 0.6);
`;
