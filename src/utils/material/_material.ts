import * as THREE from "three";
import { NIGHT_BLEND_UNIFORM, NIGHT_GROUND_DIM } from "../../lighting/dayNight";
import { LAMP_GRID_UNIFORMS, lampGlowAccumGLSL } from "../../lighting/lampGlow";
import { Biome } from "../../world/types";
import commonShader from "../../world/shaders/common.glsl";

/**
 * EXPERIMENT: let real scene point lights (CityLights beacons, indoor rig)
 * shade the otherwise-unlit terrain. Adds a NUM_POINT_LIGHTS lambert loop per
 * terrain fragment — flip to false to restore the fully unlit terrain if the
 * frame cost isn't worth it.
 */
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
    } = {},
  ): Promise<THREE.ShaderMaterial> => {
    const { riverTexture, biomeTexture, varyingDeclarations = [] } = options;
    // Collect all uniforms and fragment shaders from biomes
    // uNightBlend / the lamp-grid uniforms are SHARED objects — updated by
    // the day/night cycle and StreetLampPool, so every terrain material
    // dims and catches lamp light in lockstep.
    const combinedUniforms: any = { uNightBlend: NIGHT_BLEND_UNIFORM, ...LAMP_GRID_UNIFORMS };

    // Scene-light uniforms (pointLights[], ambient, etc.) — the renderer
    // writes light state into these each frame when material.lights is true.
    // They are struct/array uniforms, so they must NOT go through the scalar
    // uniform-declaration generator below (see LIGHTS_UNIFORM_KEYS filter).
    if (TERRAIN_POINT_LIGHTS) {
      Object.assign(combinedUniforms, THREE.UniformsUtils.clone(THREE.UniformsLib.lights));
    }
    const LIGHTS_UNIFORM_KEYS = new Set(Object.keys(THREE.UniformsLib.lights));

    // Add river texture if provided (between regions)
    if (riverTexture) {
      combinedUniforms.rivertexture = { value: riverTexture };
    }

    // Add biome boundary texture if provided (between biomes within a region)
    if (biomeTexture) {
      combinedUniforms.biometexture = { value: biomeTexture };
    }

    const fragmentFunctions: string[] = [];

    for (const biome of biomes) {
      if (biome.getMaterial) {
        const biomeMaterial = await biome.getMaterial();

        // Merge uniforms
        Object.assign(combinedUniforms, biomeMaterial.uniforms);

        // Strip out all declarations (varying, uniform)
        let cleanShader = biomeMaterial.fragmentShader
          // Remove varying declarations
          .replace(/varying\s+\w+\s+\w+;/g, "")
          // Remove uniform declarations (any type)
          .replace(/uniform\s+\w+\s+\w+;/g, "")
          // Remove extra whitespace/newlines
          .replace(/^\s*[\r\n]/gm, "");

        // Extract the main function body and rename it to biome_frag
        const fragmentBody = cleanShader.replace(/void main\(\) \{/, `void ${biome.name}_frag() {`).trim();

        fragmentFunctions.push(fragmentBody);
      }
    }

    // Build the combined fragment shader
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

      // Global river blending
      if (vDistanceToRiverCenter < 50.0) {
        vec2 riverUV = fract(vWorldUv);
        vec4 riverColor = texture2D(rivertexture, riverUV);
        float riverBlend = smoothstep(14.0, 50.0, vDistanceToRiverCenter);
        gl_FragColor = mix(riverColor, gl_FragColor, riverBlend);
      }

      // Day/night: terrain is unlit, so scene-light dimming can't reach it —
      // darken directly by the shared night blend.
      gl_FragColor.rgb *= mix(1.0, ${NIGHT_GROUND_DIM.toFixed(3)}, uNightBlend);

      // Street-lamp glow: real gradient pools of light on the road (added
      // AFTER the night dim so lamps genuinely brighten the ground). Uses the
      // ABSOLUTE world position — lamp positions in the grid are absolute,
      // and the wrapped vWorldPos aliased the glow onto the wrong chunks.
      ${lampGlowAccumGLSL("vWorldPosAbs")}
      gl_FragColor.rgb += lampGlowSum * 0.25;

      ${
        TERRAIN_POINT_LIGHTS
          ? `// EXPERIMENT (TERRAIN_POINT_LIGHTS): scene point lights shade the
      // terrain — lambert with three's physical distance attenuation.
      // pointLights[i].position is VIEW-space, color is premultiplied by
      // intensity; parked pool lights have intensity 0 and contribute nothing.
      // vWorldPosAbs, not vWorldPos: the view matrix expects an ABSOLUTE
      // world position, and the wrapped one lit the wrong chunks.
      #if NUM_POINT_LIGHTS > 0
      {
        vec3 plViewPos = (viewMatrix * vec4(vWorldPosAbs, 1.0)).xyz;
        vec3 plViewNormal = normalize((viewMatrix * vec4(vWorldNormal, 0.0)).xyz);
        vec3 pointLightSum = vec3(0.0);
        for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
          // Parked pool lights (intensity 0 → premultiplied color 0) skip the
          // whole falloff math — a uniform-coherent branch, so the usual
          // 5-7 dead lights cost ~nothing per fragment.
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

      // ±0.5/255 screen-space hash dither — the night dim and point-light
      // falloff are slow gradients that band into visible rings at 8 bits.
      gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    }
  `;

    return new THREE.ShaderMaterial({
      // wireframe: true,
      uniforms: combinedUniforms,
      vertexShader,
      fragmentShader,
      lights: TERRAIN_POINT_LIGHTS,
    });
  };
}
