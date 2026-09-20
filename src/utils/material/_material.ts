import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, nightDimGLSL } from "../../lighting/dayNight";
import { ditherGLSL } from "../../vfx/dither";
import { LAMP_GRID_UNIFORMS, lampGlowAccumGLSL } from "../../lighting/lampGlow";
import { Biome } from "../../world/types";
import commonShader from "../../world/shaders/common.glsl";

/** EXPERIMENT: scene point lights shade the otherwise-unlit terrain (a per-fragment
 *  NUM_POINT_LIGHTS lambert loop). Flip off if the frame cost isn't worth it. */
export const TERRAIN_POINT_LIGHTS = true;

export namespace _material {
  export const loadTextures = async (filenames: string[]): Promise<THREE.Texture[]> => {
    const textureLoader = new THREE.TextureLoader();
    return Promise.all(
      filenames.map(
        (filename) =>
          new Promise<THREE.Texture>((resolve, reject) =>
            textureLoader.load(
              process.env.PUBLIC_URL + "/textures/" + filename,
              (tex) => {
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                resolve(tex);
              },
              undefined,
              reject,
            ),
          ),
      ),
    );
  };

  const getUniformDeclaration = (name: string, uniform: { value: any }): string => {
    const v = uniform.value;
    if (v instanceof THREE.Texture || v === null) return `uniform sampler2D ${name};`;
    if (typeof v === "number") return `uniform float ${name};`;
    if (v instanceof THREE.Vector2) return `uniform vec2 ${name};`;
    if (v instanceof THREE.Vector3) return `uniform vec3 ${name};`;
    if (v instanceof THREE.Vector4) return `uniform vec4 ${name};`;
    return `uniform sampler2D ${name};`;
  };

  export const combineBiomeMaterials = async (
    biomes: Biome[],
    vertexShader: string,
    options: {
      riverTexture?: THREE.Texture;
      biomeTexture?: THREE.Texture;
      varyingDeclarations?: string[];
      defines?: Record<string, string>;
    } = {},
  ): Promise<THREE.ShaderMaterial> => {
    const { riverTexture, biomeTexture, varyingDeclarations = [], defines = {} } = options;
    // uNightBlend and the lamp-grid uniforms are SHARED objects so every terrain material dims in lockstep.
    const combinedUniforms: any = { uNightBlend: NIGHT_BLEND_UNIFORM, ...LAMP_GRID_UNIFORMS };

    // Scene-light uniforms are struct/array uniforms the renderer writes (material.lights);
    // they must NOT go through the scalar declaration generator below.
    if (TERRAIN_POINT_LIGHTS) {
      Object.assign(combinedUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
    }
    const LIGHTS_UNIFORM_KEYS = new Set(Object.keys(THREE.UniformsLib.lights));

    if (riverTexture) {
      combinedUniforms.rivertexture = { value: riverTexture };
    }

    if (biomeTexture) {
      combinedUniforms.biometexture = { value: biomeTexture };
    }

    const fragmentFunctions: string[] = [];

    for (const biome of biomes) {
      if (biome.getMaterial) {
        const biomeMaterial = await biome.getMaterial();

        Object.assign(combinedUniforms, biomeMaterial.uniforms);

        let strippedFragmentShader = biomeMaterial.fragmentShader
          .replace(/varying\s+\w+\s+\w+;/g, "")
          .replace(/uniform\s+\w+\s+\w+;/g, "")
          .replace(/^\s*[\r\n]/gm, "");

        const fragmentBody = strippedFragmentShader.replace(/void main\(\) \{/, `void ${biome.name}_frag() {`).trim();

        fragmentFunctions.push(fragmentBody);
      }
    }

    const fragmentShader = `
    ${varyingDeclarations.join("\n    ")}

    ${Object.entries(combinedUniforms)
      .filter(([name]) => !LIGHTS_UNIFORM_KEYS.has(name))
      .map(([name, uniform]) => getUniformDeclaration(name, uniform as { value: any }))
      .join("\n    ")}

    ${
      TERRAIN_POINT_LIGHTS
        ? `#if NUM_POINT_LIGHTS > 0
      struct PointLight {
        vec3 position;
        vec3 color;
        float distance;
        float decay;
      };
      uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
    #endif`
        : ""
    }

    ${commonShader}

    ${fragmentFunctions.join("\n\n    ")}

    void main() {
      ${biomes
        .map((biome) => {
          return `if (vBiomeId == ${biome.id}) {
        ${biome.name}_frag();
      }`;
        })
        .join("\n      ")}

      if (vDistanceToRiverCenter < 50.0) {
        vec2 riverUV = fract(vWorldUv);
        vec4 riverColor = texture2D(rivertexture, riverUV);
        float riverBlend = smoothstep(14.0, 50.0, vDistanceToRiverCenter);
        gl_FragColor = mix(riverColor, gl_FragColor, riverBlend);
      }

      ${nightDimGLSL("gl_FragColor.rgb")}

      // Lamp glow after the night dim so lamps brighten the ground; ABSOLUTE
      // position — the wrapped one aliased the glow onto the wrong chunks.
      ${lampGlowAccumGLSL("vWorldPosAbs")}
      gl_FragColor.rgb += lampGlowSum * 0.25;

      ${
        TERRAIN_POINT_LIGHTS
          ? `// EXPERIMENT (TERRAIN_POINT_LIGHTS): lambert from the scene point lights.
      // pointLights[i].position is VIEW-space, color premultiplied by intensity.
      // ABSOLUTE position (wrapped lit the wrong chunks); gated on the night
      // blend because every scene point light follows it — by day this is dead work.
      #if NUM_POINT_LIGHTS > 0
      if (uNightBlend > 0.001) {
        vec3 plViewPos = (viewMatrix * vec4(vWorldPosAbs, 1.0)).xyz;
        vec3 plViewNormal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz);
        vec3 pointLightSum = vec3(0.0);
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          // Parked pool lights have color 0 — uniform-coherent skip.
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
      #endif`
          : ""
      }

      // Slow gradients band into rings at 8 bits without the dither.
      ${ditherGLSL("gl_FragColor.rgb")}
    }
  `;

    return new THREE.ShaderMaterial({
      uniforms: combinedUniforms,
      defines,
      vertexShader,
      fragmentShader,
      lights: TERRAIN_POINT_LIGHTS,
    });
  };
}
