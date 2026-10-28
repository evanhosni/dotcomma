import { NIGHT_GROUND_DIM } from "../../lighting/dayNight";
import { FLASHLIGHT_DIR_UNIFORM, FLASHLIGHT_UNIFORM, PERSONAL_LIGHT_UNIFORM } from "../../lighting/personalLight";

/**
 * THE cave rock formula, shared by the cave wall material (objects/underground) and the
 * terrain's ENTRANCE variant: color from position and normal, the terrain's fake sun, dimmed by the
 * daylight to a deep-tunnel ambient, plus the player's PERSONAL LIGHT and the dev FLASHLIGHT
 * (lighting/personalLight.ts).
 * Both programs compute identical colors at the vertices the entrance patch and the walls share.
 * Needs `uniform float uNightBlend` declared before it (TUNNEL_LIGHT_GLSL below).
 */

/** Deep in a tunnel the surface keeps this share of its lit color, tinted toward the blue of
 *  light that has bounced its way in — darker than comfortable: torches come later. */
const TUNNEL_AMBIENT = 0.028;
const TUNNEL_AMBIENT_TINT = "vec3(0.62, 0.76, 1.18)";
/** The personal light: this share of the surface color within HEADLAMP_NEAR of the camera, gone by
 *  HEADLAMP_FAR, scaled by the personal-light uniform (0 until the player has stood in the dark). */
const HEADLAMP_STRENGTH = 0.22;
const HEADLAMP_NEAR = 1.5;
const HEADLAMP_FAR = 10;
const HEADLAMP_TINT = "vec3(1.0, 0.96, 0.88)";
/** The flashlight: a cone from the camera along its view, full within FLASHLIGHT_INNER_COS of its
 *  axis, gone at FLASHLIGHT_OUTER_COS (~18° / ~35°), reaching FLASHLIGHT_FAR; surfaces facing it brightest. */
const FLASHLIGHT_STRENGTH = 1.1;
const FLASHLIGHT_INNER_COS = 0.95;
const FLASHLIGHT_OUTER_COS = 0.82;
const FLASHLIGHT_NEAR = 15;
const FLASHLIGHT_FAR = 60;

/** THE light in a tunnel, as a multiplier of a surface's color: the fake sun where daylight reaches (dimmed
 *  by the night with the ground outside), the deep blue ambient where it does not, plus the player's own
 *  light. Shared by the walls (tunnelShade below) and every ACTOR standing in a tunnel
 *  (lighting/tunnelLight.ts), so a beeble in a cave is lit exactly as the rock beside it. Needs
 *  `uniform float uNightBlend` declared before it; declares the personal light's uniforms (a program
 *  including it must carry PERSONAL_LIGHT_UNIFORMS). */
export const TUNNEL_LIGHT_GLSL = /* glsl */ `
  uniform float ${PERSONAL_LIGHT_UNIFORM};
  uniform float ${FLASHLIGHT_UNIFORM};
  uniform vec3 ${FLASHLIGHT_DIR_UNIFORM};
  /** The player's own light on a tunnel surface where daylight does not reach: the headlamp's share
   *  by distance plus the flashlight's cone. \`toSurface\` is the surface's position from the camera. */
  float tunnelPersonalLight(vec3 normal, float day, vec3 toSurface) {
    float cameraDistance = length(toSurface);
    float lamp = ${HEADLAMP_STRENGTH.toFixed(2)} * ${PERSONAL_LIGHT_UNIFORM} * (1.0 - smoothstep(${HEADLAMP_NEAR.toFixed(1)}, ${HEADLAMP_FAR.toFixed(1)}, cameraDistance));
    vec3 ray = toSurface / max(cameraDistance, 1e-3);
    float beam = ${FLASHLIGHT_STRENGTH.toFixed(2)} * ${FLASHLIGHT_UNIFORM} * smoothstep(${FLASHLIGHT_OUTER_COS.toFixed(2)}, ${FLASHLIGHT_INNER_COS.toFixed(2)}, dot(ray, ${FLASHLIGHT_DIR_UNIFORM}))
      * (1.0 - smoothstep(${FLASHLIGHT_NEAR.toFixed(1)}, ${FLASHLIGHT_FAR.toFixed(1)}, cameraDistance)) * (0.3 + 0.7 * max(dot(normal, -ray), 0.0));
    return (lamp + beam) * (1.0 - day);
  }
  /** The night dim is the DAYLIT term's alone: deep in a tunnel the ambient and the player's light know
   *  nothing of the sky, while a mouth dims with the ground around it (a caller must not dim again).
   *  The sun is common.glsl's fakeSunLight, inlined so a program without common.glsl can light. */
  vec3 tunnelLightFactor(vec3 normal, float daylight, vec3 toSurface) {
    float day = clamp(daylight, 0.0, 1.0);
    float sun = clamp(dot(normalize(normal), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
    vec3 lit = vec3((0.6 + 0.4 * sun) * mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend));
    return mix(vec3(${TUNNEL_AMBIENT.toFixed(3)}) * ${TUNNEL_AMBIENT_TINT}, lit, day) + ${HEADLAMP_TINT} * tunnelPersonalLight(normal, day, toSurface);
  }
`;

export const TUNNEL_ROCK_GLSL = /* glsl */ `
  ${TUNNEL_LIGHT_GLSL}
  /** A smooth grain of ~20–30u over the rock. */
  float tunnelRockGrain(vec3 p) {
    return sin(p.x * 0.21 + p.z * 0.17 + sin(p.y * 0.3)) * sin(p.y * 0.31 - p.x * 0.11 + p.z * 0.07);
  }
  /** Wall rock turning to floor as the normal faces up, with grain. The constants are LINEAR and
   *  neither program encodes its output (the terrain reads its sRGB textures raw), so the color is
   *  encoded here, like the ground beside it. */
  vec3 tunnelRockColor(vec3 worldAbs, vec3 normal) {
    float up = smoothstep(0.2, 0.85, normal.y);
    vec3 base = mix(vec3(0.4, 0.4, 0.43), vec3(0.33, 0.3, 0.27), up);
    return pow(max(base * (1.0 + 0.12 * tunnelRockGrain(worldAbs)), vec3(0.0)), vec3(1.0 / 2.2));
  }
  /** A tunnel surface's color: its base under THE tunnel light. */
  vec3 tunnelShade(vec3 base, vec3 normal, float daylight, vec3 toSurface) {
    return base * tunnelLightFactor(normal, daylight, toSurface);
  }
`;
