import * as THREE from "three";
import { AXIS_LIFT, DAYLIGHT_MANHOLE_FAR, DAYLIGHT_MANHOLE_NEAR, DAYLIGHT_MOUTH_FAR, DAYLIGHT_MOUTH_NEAR, FOOTPRINT_PAD, MOUTH_RIM_AMP } from "../../utils/workers/underground/constants";

/**
 * TERRAIN OPENINGS: the per-pixel cuts the tunnels make in the ground. A hole is a manhole SHAFT (a
 * vertical cylinder, cut all the way down) or a cave mouth's FOOTPRINT (the capsule along its section,
 * only up to `capHeight` over the section's floor — the mountain above the opening stays, drawn by
 * the terrain over the entrance patch's same ground — cut by the entrance's screen-door share, whose
 * complement the entrance patch draws). A SKIRT pixel standing SKIRT_MASK_COVER under its own ground
 * inside a SKIRT MASK (a capsule over a run of tunnel) — or anywhere, while the camera is underground —
 * is discarded too: it can only be seen from inside the tunnel, and from outside the ground hides it;
 * a skirt pixel nearer its ground is the LOD-border gap's cover and stays (masks reaching the surface
 * cut dashes out of the skirts along every tunnel). Shared uniform OBJECTS: every terrain variant
 * reads the same set; only chunks touching a hole or mask compile the discard in
 * (world/terrain/material.ts).
 */

export const MAX_TERRAIN_HOLES = 16;
export const MAX_TUNNEL_MASKS = 32;
/** A skirt pixel is hidden only this far (u) under its own ground: the LOD-border gap it exists for is
 *  above that, a tunnel's air (ROCK_COVER 4u under the ground) below it. */
export const SKIRT_MASK_COVER = 2;
export const TERRAIN_HOLES_DEFINE = "TERRAIN_HOLES";

export interface TerrainHole {
  kind: "shaft" | "mouth";
  id: string;
  /** A shaft: the center at the street (a = b); a mouth: the section from the opening to its inner end. */
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  /** The entrance fade's share of the cut (a shaft: 1). */
  share: number;
  /** A mouth: how far over the section's floor (interpolated along it) the cut reaches; a shaft: unused. */
  capHeight: number;
  /** A mouth: how far past `radius` the entrance PATCH keeps drawing (the footprint band both draw); a shaft: 0. */
  band: number;
}

export interface TunnelMask {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
  /** The top of the tunnel air it holds (SkirtMask.ceiling). */
  ceiling: number;
}

export const TERRAIN_HOLE_UNIFORMS = {
  uTerrainHoles: { value: new Float32Array(MAX_TERRAIN_HOLES * 3 * 4) } as THREE.IUniform<Float32Array>,
  uTerrainHoleCount: { value: 0 } as THREE.IUniform<number>,
  uTunnelMasks: { value: new Float32Array(MAX_TUNNEL_MASKS * 2 * 4) } as THREE.IUniform<Float32Array>,
  uTunnelMaskCount: { value: 0 } as THREE.IUniform<number>,
  uTunnelNoSkirts: { value: 0 } as THREE.IUniform<number>,
};

let holes: TerrainHole[] = [];
let masks: TunnelMask[] = [];
let version = 0;
let membership = "";
let cameraUnderground = false;

/** Bumped when the SET of holes or masks changes (a share moving does not): the chunks re-pick their variant. */
export const terrainHolesVersion = (): number => version;

export const setCameraUnderground = (underground: boolean): void => {
  if (underground === cameraUnderground) return;
  cameraUnderground = underground;
  TERRAIN_HOLE_UNIFORMS.uTunnelNoSkirts.value = underground ? 1 : 0;
};

export const isCameraUnderground = (): boolean => cameraUnderground;

/** The cut set, at most MAX_TERRAIN_HOLES and MAX_TUNNEL_MASKS (the caller orders them nearest first). */
export const setTerrainHoles = (nextHoles: readonly TerrainHole[], nextMasks: readonly TunnelMask[]): void => {
  holes = nextHoles.slice(0, MAX_TERRAIN_HOLES);
  masks = nextMasks.slice(0, MAX_TUNNEL_MASKS);
  const h = TERRAIN_HOLE_UNIFORMS.uTerrainHoles.value;
  holes.forEach((hole, i) => {
    const o = i * 12;
    h[o] = hole.ax;
    h[o + 1] = hole.ay;
    h[o + 2] = hole.az;
    h[o + 3] = hole.radius;
    h[o + 4] = hole.bx;
    h[o + 5] = hole.by;
    h[o + 6] = hole.bz;
    h[o + 7] = hole.share;
    h[o + 8] = hole.kind === "shaft" ? 1 : 0;
    h[o + 9] = hole.capHeight;
    h[o + 10] = hole.band;
    h[o + 11] = 0;
  });
  TERRAIN_HOLE_UNIFORMS.uTerrainHoleCount.value = holes.length;
  const m = TERRAIN_HOLE_UNIFORMS.uTunnelMasks.value;
  masks.forEach((mask, i) => {
    const o = i * 8;
    m[o] = mask.ax;
    m[o + 1] = mask.ay;
    m[o + 2] = mask.az;
    m[o + 3] = mask.radius;
    m[o + 4] = mask.bx;
    m[o + 5] = mask.by;
    m[o + 6] = mask.bz;
    m[o + 7] = mask.ceiling;
  });
  TERRAIN_HOLE_UNIFORMS.uTunnelMaskCount.value = masks.length;
  const key = holes.map((x) => x.id).join("|") + "#" + masks.map((x) => `${x.ax},${x.az},${x.bx},${x.bz}`).join("|");
  if (key !== membership) {
    membership = key;
    version++;
  }
};

/** Whether any hole or mask touches a square of the ground (by their horizontal extents). */
export const squareTouchesTerrainHoles = (minX: number, minZ: number, maxX: number, maxZ: number): boolean => {
  for (const h of holes) {
    if (Math.min(h.ax, h.bx) - h.radius <= maxX && Math.max(h.ax, h.bx) + h.radius >= minX && Math.min(h.az, h.bz) - h.radius <= maxZ && Math.max(h.az, h.bz) + h.radius >= minZ) return true;
  }
  for (const m of masks) {
    if (Math.min(m.ax, m.bx) - m.radius <= maxX && Math.max(m.ax, m.bx) + m.radius >= minX && Math.min(m.az, m.bz) - m.radius <= maxZ && Math.max(m.az, m.bz) + m.radius >= minZ) return true;
  }
  return false;
};

/** VERTEX stage, for a mesh that is not part of the tunnels (an actor): whether a point is in a tunnel's
 *  AIR — inside a loaded skirt mask (the 32 nearest the camera) and under its ceiling, over a 1u edge —
 *  and the daylight reaching it from the openings (the 16 nearest: a shaft's street, a mouth's axis),
 *  falling off as the walls' baked daylight does (underground/chunkMesh.ts daylightAt). Reads the
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
        // The opening's radius r0 from the cut's radius (the widest outline + the pad, less the band).
        float r0 = (h0.w + h2.z - ${FOOTPRINT_PAD.toFixed(1)}) / ${(1 + MOUTH_RIM_AMP).toFixed(2)};
        source = h0.xyz + vec3(0.0, ${AXIS_LIFT.toFixed(2)} * r0, 0.0);
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
/** A patch pixel whose rock share is under this is GROUND: only those give way to the terrain where the
 *  mouth's cut does not reach (combineBiomeMaterials.ts); a wall pixel is never cut. */
export const PATCH_GROUND_SHARE = 0.05;
export const ENTRANCE_FADE_UNIFORM = "uEntranceFade";
export const ENTRANCE_PATCH_GLSL = /* glsl */ `
uniform float ${ENTRANCE_FADE_UNIFORM};
bool entranceFadeDiscards() {
  return ${ENTRANCE_FADE_UNIFORM} < 1.0 && ${ENTRANCE_FADE_UNIFORM} <= screenDoorThreshold(gl_FragCoord.xy);
}
`;
