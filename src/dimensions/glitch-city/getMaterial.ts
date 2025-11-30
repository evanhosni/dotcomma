import * as THREE from "three";
import { utils } from "../../utils/utils";
import { GlitchCity } from "./GlitchCity";
import vertexShader from "./shaders/vertex.glsl";

export const getMaterial = async () => {
  const biomes = utils.getAllBiomes(GlitchCity);

  // Collect all uniforms and fragment shaders from biomes
  const combinedUniforms: any = {};
  const fragmentFunctions: string[] = [];

  for (const biome of biomes) {
    if (biome.getMaterial) {
      const biomeMaterial = await biome.getMaterial();

      // Merge uniforms
      Object.assign(combinedUniforms, biomeMaterial.uniforms);

      // Strip out all declarations (varying, uniform) and extract only the main function
      let cleanShader = biomeMaterial.fragmentShader
        // Remove varying declarations
        .replace(/varying\s+\w+\s+\w+;/g, '')
        // Remove uniform declarations
        .replace(/uniform\s+sampler2D\s+\w+;/g, '')
        // Remove extra whitespace/newlines
        .replace(/^\s*[\r\n]/gm, '');

      // Extract the main function body and rename it to biome_frag
      const fragmentBody = cleanShader
        .replace(/void main\(\) \{/, `void ${biome.name}_frag() {`)
        .trim();

      fragmentFunctions.push(fragmentBody);
    }
  }

  // Build the combined fragment shader
  const fragmentShader = `
    varying float vDistanceToRoadCenter;
    flat varying int vBiomeId;
    varying vec2 vUv;

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

  const material = new THREE.ShaderMaterial({
    uniforms: combinedUniforms,
    vertexShader,
    fragmentShader,
  });

  return material;
};
