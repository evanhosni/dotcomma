import * as THREE from "three";
import { chainMaterialPatch } from "../vfx/materialPatch";
import { TERRAIN_HOLE_UNIFORMS, TUNNEL_AIR_VERTEX_GLSL } from "../world/shaders/terrainHoles";
import { TUNNEL_LIGHT_GLSL } from "../world/shaders/tunnelRock";
import { NIGHT_BLEND_UNIFORM } from "./dayNight";
import { PERSONAL_LIGHT_UNIFORMS } from "./personalLight";

/**
 * TUNNEL LIGHT on an actor: a vertex in a tunnel's air (world/shaders/terrainHoles.ts tunnelAirAt) is lit
 * by THE tunnel light (world/shaders/tunnelRock.ts tunnelLightFactor) instead of the scene's sun, moon and
 * ambient: the deep ambient, the player's own light and flashlight, and the daylight of an opening near
 * it — exactly as the rock beside it. Outside, the scene's lighting is untouched; across a mouth the two
 * blend per vertex. Positional, so no per-object state: a shared material lights every instance where it
 * stands. Applied from the actor base only (objects/actors/Actor.tsx prepareActorMaterial).
 */
export const patchMaterialTunnelLight = (material: THREE.Material): void => {
  if ((material as any).__tunnelLightPatched) return;
  chainMaterialPatch(material, "_tunnelLight", (shader) => {
    // Only LIT materials (a normal, an outgoingLight to replace): an unlit one never saw the sky's light.
    if (!shader.fragmentShader.includes("#include <opaque_fragment>") || !shader.fragmentShader.includes("#include <normal_fragment_begin>")) return;
    shader.uniforms.uTerrainHoles = TERRAIN_HOLE_UNIFORMS.uTerrainHoles;
    shader.uniforms.uTerrainHoleCount = TERRAIN_HOLE_UNIFORMS.uTerrainHoleCount;
    shader.uniforms.uTunnelMasks = TERRAIN_HOLE_UNIFORMS.uTunnelMasks;
    shader.uniforms.uTunnelMaskCount = TERRAIN_HOLE_UNIFORMS.uTunnelMaskCount;
    shader.uniforms.uNightBlend = NIGHT_BLEND_UNIFORM;
    Object.assign(shader.uniforms, PERSONAL_LIGHT_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TUNNEL_AIR_VERTEX_GLSL}\nvarying float vTunnelAir;\nvarying float vTunnelDaylight;\nvarying vec3 vTunnelWorldPos;`)
      .replace(
        "#include <skinning_vertex>",
        `#include <skinning_vertex>
        // After skinning: an animated actor is lit where its limbs ARE.
        vec4 tunnelLocal = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        tunnelLocal = instanceMatrix * tunnelLocal;
        #endif
        vTunnelWorldPos = (modelMatrix * tunnelLocal).xyz;
        vTunnelAir = tunnelAirAt(vTunnelWorldPos);
        vTunnelDaylight = vTunnelAir > 0.0 ? tunnelDaylightAt(vTunnelWorldPos) : 1.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nuniform float uNightBlend;\n${TUNNEL_LIGHT_GLSL}\nvarying float vTunnelAir;\nvarying float vTunnelDaylight;\nvarying vec3 vTunnelWorldPos;`)
      .replace(
        "#include <opaque_fragment>",
        `if (vTunnelAir > 0.001) {
          vec3 tunnelNormal = inverseTransformDirection(normal, viewMatrix);
          vec3 tunnelLit = diffuseColor.rgb * tunnelLightFactor(tunnelNormal, vTunnelDaylight, vTunnelWorldPos - cameraPosition);
          outgoingLight = mix(outgoingLight, tunnelLit, vTunnelAir);
        }
        #include <opaque_fragment>`,
      );
  });
  (material as any).__tunnelLightPatched = true;
};
