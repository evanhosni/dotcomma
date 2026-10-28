import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM } from "../../lighting/dayNight";
import { PERSONAL_LIGHT_UNIFORMS } from "../../lighting/personalLight";
import { ditherGLSL } from "../../vfx/dither";
import { _spawnFade } from "../../vfx/spawnFade";
import { CHUNK_PROJECTION_GLSL, CHUNK_PROJECTION_UNIFORMS } from "../shaders/chunkProjection";
import commonShader from "../shaders/common.glsl";
import { ENTRANCE_FADE_UNIFORM } from "../shaders/terrainHoles";
import { glslFloat, WORLD_WRAP } from "../shaders/constants";
import { TUNNEL_ROCK_GLSL } from "../shaders/tunnelRock";

/**
 * The tunnels' materials. Every custom program here keeps the terrain's precision scheme, its
 * quantization and the world curvature (world/shaders/chunkProjection.ts), and is spawn-faded by the
 * dressing base's twin scheme (_spawnFade.patchMaterial supplies screenDoorThreshold, so nothing else
 * may declare it). The day/night cycle reaches a tunnel only through `tunnelShade`'s daylit term
 * (world/shaders/tunnelRock.ts): no program here dims its output by the night.
 */

const FRAGMENT_PRELUDE = /* glsl */ `
  uniform float uNightBlend;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosWrapped;
  varying vec3 vWorldPosAbs;
  ${commonShader}
  ${TUNNEL_ROCK_GLSL}
`;

const sharedUniforms = () => ({ ...CHUNK_PROJECTION_UNIFORMS, uNightBlend: NIGHT_BLEND_UNIFORM, ...PERSONAL_LIGHT_UNIFORMS });

const finish = (material: THREE.ShaderMaterial): THREE.ShaderMaterial => {
  material.defines = { ...material.defines, WORLD_WRAP: glslFloat(WORLD_WRAP) };
  _spawnFade.patchMaterial(material);
  return material;
};

/** The cave walls: the rock formula (world/shaders/tunnelRock.ts) from position and normal, lit by
 *  the vertex's daylight; keeps the complement of the entrance fade's screen-door pixels. */
export const createCaveRockMaterial = (): THREE.ShaderMaterial =>
  finish(
    new THREE.ShaderMaterial({
      uniforms: { ...sharedUniforms(), [ENTRANCE_FADE_UNIFORM]: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float daylight;
        varying float vDaylight;
        ${CHUNK_PROJECTION_GLSL}
        void main() {
          vDaylight = daylight;
          gl_Position = projectChunkLocal(position, normal);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float ${ENTRANCE_FADE_UNIFORM};
        varying float vDaylight;
        ${FRAGMENT_PRELUDE}
        void main() {
          if (screenDoorThreshold(gl_FragCoord.xy) >= ${ENTRANCE_FADE_UNIFORM}) discard;
          vec3 n = normalize(vWorldNormal);
          vec3 col = tunnelShade(tunnelRockColor(vWorldPosAbs, n), n, vDaylight, vWorldPosAbs - cameraPosition);
          ${ditherGLSL("col")}
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );

/** The sewer walls: their vertex colors (LINEAR) under the same light, encoded on output like a lit
 *  material's (the cave rock encodes its own color: it is shared with the terrain program). */
export const createSewerWallMaterial = (): THREE.ShaderMaterial =>
  finish(
    new THREE.ShaderMaterial({
      uniforms: sharedUniforms(),
      vertexColors: true,
      vertexShader: /* glsl */ `
        attribute float daylight;
        varying float vDaylight;
        varying vec3 vColor;
        ${CHUNK_PROJECTION_GLSL}
        void main() {
          vDaylight = daylight;
          vColor = color;
          gl_Position = projectChunkLocal(position, normal);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vDaylight;
        varying vec3 vColor;
        ${FRAGMENT_PRELUDE}
        void main() {
          vec3 n = normalize(vWorldNormal);
          vec3 col = tunnelShade(vColor, n, vDaylight, vWorldPosAbs - cameraPosition);
          ${ditherGLSL("col")}
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );

/** Everything standing IN a tunnel (doors, frames, plates, bolts, rungs): lit as the deep walls — no
 *  daylight, the headlamp — in its vertex color, or its instance color when instanced. */
export const createTunnelObjectMaterial = (): THREE.ShaderMaterial =>
  finish(
    new THREE.ShaderMaterial({
      uniforms: sharedUniforms(),
      vertexColors: true,
      vertexShader: /* glsl */ `
        varying vec3 vColor;
        ${CHUNK_PROJECTION_GLSL}
        void main() {
          #ifdef USE_INSTANCING_COLOR
          vColor = instanceColor;
          #else
          vColor = color;
          #endif
          vec3 local = position;
          vec3 localNormal = normal;
          #ifdef USE_INSTANCING
          local = (instanceMatrix * vec4(position, 1.0)).xyz;
          localNormal = mat3(instanceMatrix) * normal;
          #endif
          gl_Position = projectChunkLocal(local, localNormal);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        ${FRAGMENT_PRELUDE}
        void main() {
          vec3 n = normalize(vWorldNormal);
          vec3 col = tunnelShade(vColor, n, 0.0, vWorldPosAbs - cameraPosition);
          ${ditherGLSL("col")}
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );

/** The sewers' standing liquid: glossy green with drifting lighter streaks, lit as the deep walls —
 *  the player's own light alone, its gloss with it — so it is dark wherever the walls are (a glow of
 *  its own showed the whole channel from any distance). */
export const createLiquidMaterial = (): THREE.ShaderMaterial =>
  finish(
    new THREE.ShaderMaterial({
      // LINEAR: 0x5a8a22; encoded on output.
      uniforms: { ...sharedUniforms(), uTime: { value: 0 }, uLiquidColor: { value: new THREE.Vector3(0.102, 0.254, 0.016) } },
      vertexShader: /* glsl */ `
        ${CHUNK_PROJECTION_GLSL}
        void main() {
          gl_Position = projectChunkLocal(position, vec3(0.0, 1.0, 0.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uLiquidColor;
        ${FRAGMENT_PRELUDE}
        void main() {
          vec3 base = uLiquidColor;
          vec2 p = vWorldPosWrapped.xz;
          float streak = sin(p.x * 0.8 + p.y * 0.3 + uTime * 0.6) * sin(p.y * 1.3 - p.x * 0.2 - uTime * 0.45);
          vec3 color = base * (0.85 + 0.3 * smoothstep(0.2, 0.9, streak));
          vec3 toSurface = vWorldPosAbs - cameraPosition;
          vec3 up = vec3(0.0, 1.0, 0.0);
          float gloss = pow(max(dot(reflect(normalize(toSurface), up), normalize(vec3(0.3, 0.9, 0.2))), 0.0), 24.0);
          vec3 col = tunnelShade(color, up, 0.0, toSurface) + gloss * 0.15 * tunnelPersonalLight(up, 0.0, toSurface);
          ${ditherGLSL("col")}
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      side: THREE.DoubleSide,
    }),
  );

/** The manhole covers and frame rings: iron lit by the sky (the dressing base prepares it). */
export const createIronMaterial = (): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.85, metalness: 0.35 });

export const tickLiquid = (material: THREE.ShaderMaterial, time: number): void => {
  material.uniforms.uTime.value = time;
};
