import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { _curvature } from "../../vfx/curvature";
import { _quantization } from "../../vfx/quantization";
import { _spawnFade } from "../../vfx/spawnFade";

/** The one foliage shader: billboarding, sway, per-instance distance fade, quantization, curvature, night dim. */

const VERTEX_SHADER = /* glsl */ `
attribute vec3 offset;
attribute vec3 instanceData; // x: sway phase, y: size variation, z: tint variation

uniform float uTime;
uniform float uSway;
uniform float uSwaySpeed;
uniform float uWidth;
uniform float uHeight;
uniform float uRenderDistance;

varying vec2 vUv;
varying float vTint;

// Quantization + world curvature — the SAME chunks (uniform declarations +
// functions) every patched material and the terrain shader use, interpolated
// from their single sources so foliage bends with the ground it stands on.
${_quantization.QUANTIZE_GLSL}
${_curvature.CURVE_GLSL}

void main() {
  vUv = uv;
  vTint = instanceData.z;

  // Positions are chunk-relative: quantizing the ABSOLUTE offset flickered far from
  // the origin (float32 ~0.008u at 100k vs the 0.025u grid). The subtraction is exact
  // (an instance is never more than one chunk from its origin); wind/camera terms keep
  // the absolute offset so gusts stay continuous across chunk borders.
  vec3 chunkOrigin = modelMatrix[3].xyz;
  vec3 offsetRel = offset - chunkOrigin;

  float phase = instanceData.x;
  float scale = instanceData.y;

  // Per-instance fade-out scattered over the outer 70% of the render distance (full
  // density to 0.55R cost ~40% more triangles). 0.3 + 0.7 MUST sum to 1: the chunk-request
  // gate and the instanceCount truncation in FoliageField assume nothing survives past R.
  float instRand = fract(phase * 1.618 + instanceData.z * 12.9898);
  float fadeEnd = uRenderDistance * (0.3 + 0.7 * instRand);
  float dist = distance(cameraPosition.xz, offset.xz);
  float fade = 1.0 - smoothstep(fadeEnd * 0.7, fadeEnd, dist);

  float width = uWidth * scale * fade;
  float height = uHeight * scale * fade;

  vec3 look = cameraPosition - offset;
  look.y = 0.0;
  look = normalize(look + vec3(0.0001, 0.0, 0.0));
  vec3 right = vec3(look.z, 0.0, -look.x);

  vec3 pos = offsetRel + right * (position.x * width);
  pos.y += position.y * height;

  float bend = uv.y * uv.y * uSway * scale * fade;
  float t = uTime * uSwaySpeed;
  float gust = sin(t + (offset.x + offset.z) * 0.15 + phase);
  float flutter = sin(t * 2.3 + phase * 2.0) * 0.3;
  pos.x += (gust + flutter) * bend;
  pos.z += cos(t * 0.7 + (offset.x - offset.z) * 0.12 + phase) * bend * 0.7;

  pos = quantizeWorldPos(pos);

  // modelViewMatrix[3] = chunk origin in view space, resolved on the CPU in float64.
  vec3 viewPos = modelViewMatrix[3].xyz + mat3(viewMatrix) * pos;
  gl_Position = projectionMatrix * vec4(curveViewPos(viewPos), 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uNightBlend;

varying vec2 vUv;
varying float vTint;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  vec3 col = uColor * tex.rgb * (0.85 + vTint * 0.3) * (0.75 + 0.25 * vUv.y);
  ${nightDimGLSL("col")}
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface FoliageLook {
  color: string;
  sway: number;
  swaySpeed: number;
  width: number;
  height: number;
  renderDistance: number;
}

/** `quantization` picks the grid uniform at creation (unset = the global one); the look's scalars are
 *  synced afterwards by updateFoliageMaterial, without a rebuild. */
export const createFoliageMaterial = (texture: THREE.Texture, quantization: number | undefined, look: FoliageLook): THREE.ShaderMaterial => {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(look.color) },
      uMap: { value: texture },
      uSway: { value: look.sway },
      uSwaySpeed: { value: look.swaySpeed },
      uWidth: { value: look.width },
      uHeight: { value: look.height },
      uRenderDistance: { value: look.renderDistance },
      // Shared uniform objects, never mutated here.
      uGridSize: quantization !== undefined ? { value: quantization } : _quantization.uniforms.uGridSize,
      uCurveStart: _curvature.uniforms.uCurveStart,
      uCurveK: _curvature.uniforms.uCurveK,
      uNightBlend: NIGHT_BLEND_UNIFORM,
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });
  _spawnFade.patchMaterial(material);
  return material;
};

export const updateFoliageMaterial = (material: THREE.ShaderMaterial, look: FoliageLook): void => {
  material.uniforms.uColor.value.set(look.color);
  material.uniforms.uSway.value = look.sway;
  material.uniforms.uSwaySpeed.value = look.swaySpeed;
  material.uniforms.uWidth.value = look.width;
  material.uniforms.uHeight.value = look.height;
  material.uniforms.uRenderDistance.value = look.renderDistance;
};
