import { glslFloat } from "../utils";
import { LOD_FADE_DEFINE, LOD_FADE_GLSL, LOD_FADE_UNIFORM, FAR_FADE_DEFINE, FAR_FADE_GLSL, FAR_FADE_UNIFORM, WIREFRAME_DEFINE } from "../material";
import { SCREEN_DOOR_GLSL } from "../../../vfx/material";
import { ENTRANCE_PATCH_DEFINE, ENTRANCE_PATCH_GLSL, TERRAIN_HOLES_DEFINE, TERRAIN_HOLES_GLSL } from "../terrain-holes/material";
import { SNOW_WHITE_DEPTH } from "./constants";

/** Everything that is not a biome frag: the LOD and far fades, the terrain holes, the entrance patch,
 *  the scene's point lights. */
export const TERRAIN_FRAGMENT_DECLARATIONS_GLSL = `#if defined(${LOD_FADE_DEFINE}) || defined(${FAR_FADE_DEFINE}) || defined(${TERRAIN_HOLES_DEFINE}) || defined(${ENTRANCE_PATCH_DEFINE}) || defined(${WIREFRAME_DEFINE})
      ${SCREEN_DOOR_GLSL}
    #endif
    #ifdef ${LOD_FADE_DEFINE}
      uniform vec2 ${LOD_FADE_UNIFORM};
      ${LOD_FADE_GLSL}
    #endif
    #ifdef ${FAR_FADE_DEFINE}
      uniform vec2 ${FAR_FADE_UNIFORM};
    #endif
    #if defined(${FAR_FADE_DEFINE}) || defined(${WIREFRAME_DEFINE})
      ${FAR_FADE_GLSL}
    #endif
    #if defined(${TERRAIN_HOLES_DEFINE}) || defined(${ENTRANCE_PATCH_DEFINE})
      ${TERRAIN_HOLES_GLSL}
    #endif
    #ifdef ${ENTRANCE_PATCH_DEFINE}
      varying vec2 vEntranceRock;
      ${ENTRANCE_PATCH_GLSL}
    #endif

    #if NUM_POINT_LIGHTS > 0
      struct PointLight {
        vec3 position;
        vec3 color;
        float distance;
        float decay;
      };
      uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
    #endif`;

// Lambert from the scene point lights (pointLights[i].position is VIEW space, color premultiplied by
// intensity). ABSOLUTE position: the wrapped one lit the wrong chunks. Gated on the night blend because
// every scene point light follows it. Parked pool lights have color 0: a uniform-coherent skip.
export const POINT_LIGHTS_GLSL = `#if NUM_POINT_LIGHTS > 0
      if (uNightBlend > 0.001) {
        vec3 plViewPos = (viewMatrix * vec4(vWorldPosAbs, 1.0)).xyz;
        vec3 plViewNormal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz);
        vec3 pointLightSum = vec3(0.0);
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          vec3 lCol = pointLights[i].color;
          if (dot(lCol, lCol) < 1e-6) continue;
          vec3 lVec = pointLights[i].position - plViewPos;
          float lDist = max(length(lVec), 0.001);
          float atten = 1.0 / max(pow(lDist, pointLights[i].decay), 0.01);
          if (pointLights[i].distance > 0.0) {
            float edge = clamp(1.0 - pow(lDist / pointLights[i].distance, 4.0), 0.0, 1.0);
            atten *= edge * edge;
          }
          float ndotl = clamp(dot(plViewNormal, lVec / lDist), 0.0, 1.0);
          pointLightSum += lCol * (ndotl * atten);
        }
        gl_FragColor.rgb += gl_FragColor.rgb * pointLightSum;
      }
      #endif`;

/** The terrain's own snow at every LOD, after the biome mix, the bed and the road corridor: the ground
 *  whitens by its depth in a drift-varied white under the fake sun — the colour the near sheet stands in. */
export const TERRAIN_SNOW_GLSL = `if (vFarSnow > 0.0) {
        float snowGrain = worldFbm(vWorldPosWrapped.xz, 0.02, 2);
        vec3 snowWhite = mix(vec3(0.93, 0.95, 0.98), vec3(0.98, 0.99, 1.0), snowGrain) * (0.6 + 0.4 * fakeSunLight(vWorldNormal));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, snowWhite, smoothstep(0.0, ${glslFloat(SNOW_WHITE_DEPTH)}, vFarSnow));
      }`;
