import * as THREE from "three";
import { Biome } from "../../world/types";

export namespace _material {
  export const loadTextures = async (filenames: string[]): Promise<THREE.Texture[]> => {
    const textureLoader = new THREE.TextureLoader();
    return Promise.all(
      filenames.map(
        (filename) =>
          new Promise<THREE.Texture>((resolve, reject) =>
            textureLoader.load(process.env.PUBLIC_URL + "/textures/" + filename, resolve, undefined, reject)
          )
      )
    );
  };

  export const combineBiomeMaterials = async (
    biomes: Biome[],
    vertexShader: string,
    options: {
      regionTexture?: THREE.Texture;
      biomeTexture?: THREE.Texture;
      varyingDeclarations?: string[];
    } = {}
  ): Promise<THREE.ShaderMaterial> => {
    const { regionTexture, biomeTexture, varyingDeclarations = [] } = options;
    // Collect all uniforms and fragment shaders from biomes
    const combinedUniforms: any = {};

    // Add boundary texture if provided (between regions)
    if (regionTexture) {
      combinedUniforms.regiontexture = { value: regionTexture };
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

        // Strip out all declarations (varying, uniform) and extract only the main function
        let cleanShader = biomeMaterial.fragmentShader
          // Remove varying declarations
          .replace(/varying\s+\w+\s+\w+;/g, "")
          // Remove uniform declarations
          .replace(/uniform\s+sampler2D\s+\w+;/g, "")
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

    ${Object.keys(combinedUniforms)
      .map((uniformName) => `uniform sampler2D ${uniformName};`)
      .join("\n    ")}

    ${fragmentFunctions.join("\n\n    ")}

    void main() {
      ${biomes
        .map((biome) => {
          return `if (vBiomeId == ${biome.id}) {
        ${biome.name}_frag();
      }`;
        })
        .join("\n      ")}
    }
  `;

    return new THREE.ShaderMaterial({
      uniforms: combinedUniforms,
      vertexShader,
      fragmentShader,
    });
  };
}
