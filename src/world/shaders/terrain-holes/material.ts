import * as THREE from "three";
import { DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR } from "../../../generation/underground/constants";
import { MAX_TERRAIN_HOLES, MAX_TUNNEL_MASKS, SKIRT_MASK_COVER } from "./constants";

export const TERRAIN_HOLES_DEFINE = "TERRAIN_HOLES";

export const TERRAIN_HOLE_UNIFORMS = {
  uTerrainHoles: { value: new Float32Array(MAX_TERRAIN_HOLES * 3 * 4) } as THREE.IUniform<Float32Array>,
  uTerrainHoleCount: { value: 0 } as THREE.IUniform<number>,
  uTunnelMasks: { value: new Float32Array(MAX_TUNNEL_MASKS * 2 * 4) } as THREE.IUniform<Float32Array>,
  uTunnelMaskCount: { value: 0 } as THREE.IUniform<number>,
  uTunnelNoSkirts: { value: 0 } as THREE.IUniform<number>,
};

/** VERTEX stage, for a mesh that is not part of the tunnels (an actor): whether a point is in a tunnel's
 *  AIR — inside a loaded skirt mask (the 32 nearest the camera) and under its ceiling, over a 1u edge —
 *  and the daylight reaching it from the openings (the 16 nearest: a shaft's street, a mouth's axis over its
 *  opening, handed in the hole's spare float), falling off as the walls' baked daylight does
 *  (generation/underground/chunks/utils.ts daylightAt). Reads the
 *  terrain's own hole and mask uniforms: a program using it carries TERRAIN_HOLE_UNIFORMS. */
export const TUNNEL_AIR_VERTEX_GLSL = /* glsl */ `
  uniform vec4 uTerrainHoles[${MAX_TERRAIN_HOLES * 3}];
  uniform int uTerrainHoleCount;
  uniform vec4 uTunnelMasks[${MAX_TUNNEL_MASKS * 2}];
  uniform int uTunnelMaskCount;
  float tunnelAirSegment(vec3 p, vec3 a, vec3 b) {
    vec3 ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return distance(p, a + ab * t);
  }
  float tunnelAirAt(vec3 p) {
    float inside = 0.0;
    for (int i = 0; i < ${MAX_TUNNEL_MASKS}; i++) {
      if (i >= uTunnelMaskCount) break;
      vec4 m0 = uTunnelMasks[i * 2];
      vec4 m1 = uTunnelMasks[i * 2 + 1];
      float d = tunnelAirSegment(p, m0.xyz, m1.xyz);
      inside = max(inside, (1.0 - smoothstep(m0.w - 1.0, m0.w, d)) * (1.0 - smoothstep(m1.w - 1.0, m1.w, p.y)));
    }
    return inside;
  }
  float tunnelDaylightAt(vec3 p) {
    float light = 0.0;
    for (int i = 0; i < ${MAX_TERRAIN_HOLES}; i++) {
      if (i >= uTerrainHoleCount) break;
      vec4 h0 = uTerrainHoles[i * 3];
      vec4 h1 = uTerrainHoles[i * 3 + 1];
      vec4 h2 = uTerrainHoles[i * 3 + 2];
      vec3 source;
      float near;
      float far;
      if (h2.x > 0.5) {
        source = vec3(h0.x, h1.y - 1.0, h0.z);
        near = ${DAYLIGHT_MANHOLE_NEAR.toFixed(1)};
        far = ${DAYLIGHT_MANHOLE_FAR.toFixed(1)};
      } else {
        source = vec3(h0.x, h2.w, h0.z);
        near = ${DAYLIGHT_MOUTH_NEAR.toFixed(1)};
        far = ${DAYLIGHT_MOUTH_FAR.toFixed(1)};
      }
      light = max(light, 1.0 - smoothstep(near, far, distance(p, source)));
    }
    return light;
  }
`;

/** Fragment stage; needs SCREEN_DOOR_GLSL declared before it. `worldAbs` is the ABSOLUTE world
 *  position (the holes are absolute), `skirtDrop` how far a skirt pixel hangs under its ground (0 on the grid). */
export const TERRAIN_HOLES_GLSL = /* glsl */ `
  uniform vec4 uTerrainHoles[${MAX_TERRAIN_HOLES * 3}];
  uniform int uTerrainHoleCount;
  uniform vec4 uTunnelMasks[${MAX_TUNNEL_MASKS * 2}];
  uniform int uTunnelMaskCount;
  uniform float uTunnelNoSkirts;

  float terrainHoleSegment2(vec2 p, vec2 a, vec2 b) {
    vec2 ab = b - a;
    float l2 = max(dot(ab, ab), 1e-6);
    float t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
    return distance(p, a + ab * t);
  }
  float terrainHoleSegment3(vec3 p, vec3 a, vec3 b) {
    vec3 ab = b - a;
    float l2 = max(dot(ab, ab), 1e-6);
    float t = clamp(dot(p - a, ab) / l2, 0.0, 1.0);
    return distance(p, a + ab * t);
  }
  /** Whether a mouth's cut reaches this point (its footprint plus the patch band, under its ceiling): the
   *  entrance PATCH draws exactly these pixels, the terrain the rest — one rule, per pixel, on both sides. */
  bool mouthCutsHere(vec3 worldAbs) {
    for (int i = 0; i < ${MAX_TERRAIN_HOLES}; i++) {
      if (i >= uTerrainHoleCount) break;
      vec4 h0 = uTerrainHoles[i * 3];
      vec4 h1 = uTerrainHoles[i * 3 + 1];
      vec4 h2 = uTerrainHoles[i * 3 + 2];
      if (h2.x > 0.5) continue;
      vec2 ab = h1.xz - h0.xz;
      float t = clamp(dot(worldAbs.xz - h0.xz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      if (distance(worldAbs.xz, h0.xz + ab * t) < h0.w + h2.z && worldAbs.y < mix(h0.y, h1.y, t) + h2.y) return true;
    }
    return false;
  }
  bool terrainHoleDiscards(vec3 worldAbs, float skirtDrop) {
    for (int i = 0; i < ${MAX_TERRAIN_HOLES}; i++) {
      if (i >= uTerrainHoleCount) break;
      vec4 h0 = uTerrainHoles[i * 3];
      vec4 h1 = uTerrainHoles[i * 3 + 1];
      vec4 h2 = uTerrainHoles[i * 3 + 2];
      if (h2.x > 0.5) {
        if (worldAbs.y <= h1.y && distance(worldAbs.xz, h0.xz) < h0.w) return true;
      } else {
        vec2 ab = h1.xz - h0.xz;
        float t = clamp(dot(worldAbs.xz - h0.xz, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        if (distance(worldAbs.xz, h0.xz + ab * t) < h0.w && worldAbs.y < mix(h0.y, h1.y, t) + h2.y && screenDoorThreshold(gl_FragCoord.xy) < h1.w) return true;
      }
    }
    if (skirtDrop > ${SKIRT_MASK_COVER.toFixed(1)}) {
      if (uTunnelNoSkirts > 0.5) return true;
      for (int i = 0; i < ${MAX_TUNNEL_MASKS}; i++) {
        if (i >= uTunnelMaskCount) break;
        vec4 m0 = uTunnelMasks[i * 2];
        vec4 m1 = uTunnelMasks[i * 2 + 1];
        if (terrainHoleSegment3(worldAbs, m0.xyz, m1.xyz) < m0.w) return true;
      }
    }
    return false;
  }
`;

/** The cave ENTRANCE variant of the terrain program: the patch draws with the entrance fade's complement
 *  screen-door share (world/terrain/material.ts createEntranceMaterial, objects/underground). */
export const ENTRANCE_PATCH_DEFINE = "ENTRANCE_PATCH";
export const ENTRANCE_FADE_UNIFORM = "uEntranceFade";
export const ENTRANCE_PATCH_GLSL = /* glsl */ `
uniform float ${ENTRANCE_FADE_UNIFORM};
bool entranceFadeDiscards() {
  return ${ENTRANCE_FADE_UNIFORM} < 1.0 && ${ENTRANCE_FADE_UNIFORM} <= screenDoorThreshold(gl_FragCoord.xy);
}
`;
