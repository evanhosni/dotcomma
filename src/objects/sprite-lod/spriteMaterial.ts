import * as THREE from "three";
import { _curvature } from "../../vfx/curvature";
import { SCREEN_DOOR_GLSL } from "../../vfx/dither";
import { chainMaterialPatch } from "../../vfx/materialPatch";
import { SPRITE_DATA_FLOATS, SPRITE_UNPACK_GLSL } from "./layout";
import type { SpriteLook } from "./types";

/**
 * THE SPRITE BASE's material: a scene-lit MeshStandardMaterial whose quad turns about the vertical axis to face
 * the camera, lit as a facade facing the camera horizontally. Of the world-wide effects it takes curvature only:
 * a flat billboard has nothing to quantize, and lamp glow is wrong on a far stand-in. Its own screen-door
 * dither (the spawn fade's Bayer pattern) combines three visibilities:
 *  - detail: the actor's reported spawn fade (detail.ts) — the sprite draws exactly the pixels it discards;
 *  - arrival: a chunk's sprites dither in over ARRIVAL_SECONDS after it lands;
 *  - far: the last FAR_FADE_FRACTION of the kind's sprite renderDistance, measured horizontally.
 * A sprite its actor fully covers, or that is fully faded, collapses to a point and rasterizes nothing.
 */

const ARRIVAL_SECONDS = 0.6;
const FAR_FADE_FRACTION = 0.12;
const DEFAULT_ROUGHNESS = 0.85;
const DEFAULT_METALNESS = 0.05;

/** Shared by every look. Written each frame by SpriteLods: the camera relative to the rebase origin (float64 on
 *  the CPU, so it stays exact far from the world origin) and the sprite clock. */
export const SPRITE_UNIFORMS = {
  uSpriteCamera: { value: new THREE.Vector3() },
  uSpriteTime: { value: 0 },
};

const DATA_VECS = SPRITE_DATA_FLOATS / 4;
const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

const sharedDeclarations = (look: SpriteLook): string => /* glsl */ `
  uniform vec3 uSpriteCamera;
  uniform float uSpriteTime;
  varying vec2 vSpriteUv;
  flat varying vec2 vSpriteSize;
  flat varying float vSpriteDetail;
  flat varying float vSpriteVisibility;
  ${range(DATA_VECS).map((i) => `flat varying vec4 vSpriteData${i};`).join("\n")}
  vec4 spriteData[${DATA_VECS}];
  float spriteDatum(int i) { return spriteData[i / 4][i % 4]; }
  ${SPRITE_UNPACK_GLSL}
  ${look.header ?? ""}
`;

const vertexHeader = (look: SpriteLook): string => /* glsl */ `
  attribute vec3 aSpriteOffset;
  attribute vec2 aSpriteSize;
  attribute vec4 aSpriteLod; // detail, renderDistance, born, spare
  ${range(DATA_VECS).map((i) => `attribute vec4 aSpriteData${i};`).join("\n")}
  ${sharedDeclarations(look)}
`;

// Replaces beginnormal_vertex: everything below needs the view direction.
const VERTEX_SETUP = /* glsl */ `
  vec2 spriteToCamera = uSpriteCamera.xz - aSpriteOffset.xz;
  float spriteDistance = length(spriteToCamera);
  vec2 spriteViewDir = spriteDistance > 1e-4 ? spriteToCamera / spriteDistance : vec2(1.0, 0.0);
  float spriteFar = clamp((aSpriteLod.y - spriteDistance) / (aSpriteLod.y * ${FAR_FADE_FRACTION.toFixed(4)}), 0.0, 1.0);
  float spriteArrival = clamp((uSpriteTime - aSpriteLod.z) / ${ARRIVAL_SECONDS.toFixed(4)}, 0.0, 1.0);
  vSpriteVisibility = smoothstep(0.0, 1.0, spriteFar) * smoothstep(0.0, 1.0, spriteArrival);
  vSpriteDetail = aSpriteLod.x;
  vSpriteSize = aSpriteSize;
  vSpriteUv = uv;
  ${range(DATA_VECS).map((i) => `vSpriteData${i} = aSpriteData${i};`).join("\n")}
  vec3 objectNormal = vec3(spriteViewDir.x, 0.0, spriteViewDir.y);
`;

// Replaces begin_vertex. Right = forward × up for a camera looking back along the view direction, so uv.x runs
// left to right on screen.
const VERTEX_POSITION = /* glsl */ `
  bool spriteHidden = vSpriteDetail >= 1.0 || vSpriteVisibility <= 0.0;
  vec3 spriteRight = vec3(spriteViewDir.y, 0.0, -spriteViewDir.x);
  vec3 transformed = spriteHidden
    ? aSpriteOffset
    : aSpriteOffset + spriteRight * (position.x * aSpriteSize.x) + vec3(0.0, position.y * aSpriteSize.y, 0.0);
`;

// The actor's spawn fade keeps a pixel when detail == 1 or detail > threshold (spawnFade.discardGLSL); the
// sprite draws exactly the others, under its own visibility.
const FRAGMENT_SETUP = /* glsl */ `
  vec2 spriteUvPixel = fwidth(vSpriteUv);
  float spriteThreshold = screenDoorThreshold(gl_FragCoord.xy);
  if (vSpriteDetail >= 1.0 || vSpriteDetail > spriteThreshold) discard;
  if (vSpriteVisibility < 1.0 && vSpriteVisibility <= spriteThreshold) discard;
  ${range(DATA_VECS).map((i) => `spriteData[${i}] = vSpriteData${i};`).join("\n")}
  vec2 spriteUv = vSpriteUv;
  vec2 spriteSize = vSpriteSize;
`;

/** One look's material (one program per look). Its program key carries the describer, so two looks never
 *  share a program. */
export const createSpriteMaterial = (look: SpriteLook): THREE.MeshStandardMaterial => {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: look.roughness ?? DEFAULT_ROUGHNESS,
    metalness: look.metalness ?? DEFAULT_METALNESS,
  });
  material.name = `sprite:${look.describer}`;
  chainMaterialPatch(material, `_spriteLod:${look.describer}`, (shader) => {
    Object.assign(shader.uniforms, SPRITE_UNIFORMS, look.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", vertexHeader(look) + "\nvoid main() {")
      .replace("#include <beginnormal_vertex>", VERTEX_SETUP)
      .replace("#include <begin_vertex>", VERTEX_POSITION);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", sharedDeclarations(look) + SCREEN_DOOR_GLSL + "\nvoid main() {\n" + FRAGMENT_SETUP)
      .replace("#include <color_fragment>", "#include <color_fragment>\n" + look.fragment)
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n" + (look.emissive ?? ""));
  });
  _curvature.patchMaterial(material);
  return material;
};
