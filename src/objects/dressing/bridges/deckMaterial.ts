import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../../lighting/dayNight";
import { LAMP_GLOW_UNIFORMS_GLSL, LAMP_GRID_UNIFORMS, lampGlowAccumGLSL } from "../../../lighting/lampGlow";
import { ditherGLSL } from "../../../vfx/dither";
import { getTerrainParams } from "../../../world/domains/utils";

/**
 * The deck's material: the TERRAIN ROAD's look, so a deck reads as the road carried on over the
 * river rather than a slab dropped on it — the city's road texture at the terrain's
 * world tiling (bridgeRibbon's uvs keep its phase), its gutter darkening and dashed lane lines
 * (city_frag's numbers), UNLIT with the terrain's fake directional shade and night dim, plus the
 * lamp glow the terrain gets. Walls and the underside keep their vertex colors under the same shade.
 * World curvature is added by the Dressing base (prepareDressingMaterial patches the projection).
 */
export const createDeckMaterial = (): THREE.ShaderMaterial => {
  const city = getTerrainParams().cityConfig;
  const roadTexture = new THREE.TextureLoader().load(`${process.env.PUBLIC_URL}/textures/road.jpg`);
  roadTexture.wrapS = THREE.RepeatWrapping;
  roadTexture.wrapT = THREE.RepeatWrapping;
  return new THREE.ShaderMaterial({
    vertexColors: true,
    // The ground under a deck's ends is cut only BRIDGE_CUT_BELOW_TOP (0.08u) below its top, flush
    // at a landed seam; the depth buffer resolves that only within ~200u (near 0.1: a step is
    // d² / (0.1 · 2²⁴), 0.1u at 400u), so beyond it the ground won the depth test in patches — "the
    // floor clipping through" from above, gone up close (Evan, screenshot). Pulling the deck a few
    // depth steps toward the camera resolves every such tie in its favor at any distance; it moves
    // nothing that is really in front of it by more than those steps (a pixel or two far away).
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
    uniforms: {
      roadtexture: { value: roadTexture },
      uNightBlend: NIGHT_BLEND_UNIFORM,
      ...LAMP_GRID_UNIFORMS,
    },
    defines: {
      ROAD_HALF_WIDTH: city.roadWidth.toFixed(4),
      FREEWAY_HALF_WIDTH: city.freewayWidth.toFixed(4),
    },
    vertexShader: /* glsl */ `
      attribute vec4 road;
      varying vec3 vColor;
      varying vec2 vRoadUv;
      varying vec4 vRoad;
      varying vec3 vNormalW;
      varying vec3 vWorldPosAbs;
      void main() {
        vColor = color;
        vRoadUv = uv;
        vRoad = road;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        // Absolute world position: lamp-grid lookup only (float32 absolute error is fine for a falloff).
        vWorldPosAbs = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D roadtexture;
      uniform float uNightBlend;
      ${LAMP_GLOW_UNIFORMS_GLSL}
      varying vec3 vColor;
      varying vec2 vRoadUv;
      varying vec4 vRoad;
      varying vec3 vNormalW;
      varying vec3 vWorldPosAbs;
      void main() {
        vec3 color = vColor;
        if (vRoad.w > 0.5) {
          // city_frag's bands, in street units (the freeway normalization) from the centerline.
          float R = ROAD_HALF_WIDTH;
          float roadDist = abs(vRoad.x) * (ROAD_HALF_WIDTH / FREEWAY_HALF_WIDTH);
          color = texture2D(roadtexture, vRoadUv).rgb;
          // road.w: 1 on the top, 2 toward an edge whose wall is open (no gutter where the road runs on).
          float gutter = clamp(2.0 - vRoad.w, 0.0, 1.0);
          color *= 1.0 - 0.25 * gutter * smoothstep(R - 1.6, R, roadDist);
          float laneLine = 1.0 - smoothstep(0.22, 0.4, abs(abs(vRoad.x) - FREEWAY_HALF_WIDTH * 0.5));
          float laneDash = step(mod(vRoad.y, 10.0), 5.0);
          color = mix(color, vec3(0.82, 0.82, 0.8), laneLine * laneDash * vRoad.z * 0.52);
        }
        // city_frag's fake directional shading (~1.0 on flat ground); the deck top's normal is up.
        float shade = 0.62 + 0.38 * clamp(dot(normalize(vNormalW), normalize(vec3(0.35, 0.9, 0.2))), 0.0, 1.0);
        gl_FragColor = vec4(color * (shade / 0.967), 1.0);
        ${nightDimGLSL("gl_FragColor.rgb")}
        ${lampGlowAccumGLSL("vWorldPosAbs")}
        gl_FragColor.rgb += lampGlowSum * 0.25;
        ${ditherGLSL("gl_FragColor.rgb")}
      }
    `,
  });
};
