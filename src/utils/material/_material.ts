import * as THREE from "three";
import { Biome } from "../../world/types";
import commonShader from "../../world/shaders/common.glsl";

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
    const combinedUniforms: any = {};

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
      .map(([name, uniform]) => getUniformDeclaration(name, uniform as { value: any }))
      .join("\n    ")}

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
    }
  `;

    return new THREE.ShaderMaterial({
      // wireframe: true,
      uniforms: combinedUniforms,
      vertexShader,
      fragmentShader,
    });
  };
}
