import * as THREE from "three";
import { getNightIndex, getWindowLightsProgress } from "../../../lighting/dayNight";
import { prepareActorMaterial } from "../Actor";

/**
 * The materials every building shares: ONE exterior (one shader compile — colors are baked per
 * building as vertex colors), the door leaves and the interior. The interior is unlit: scene light
 * can't reach inside the shell anyway.
 */

export const DEFAULT_EXTERIOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.85,
  metalness: 0.05,
});

// Night window lights (see CLAUDE.md → Procedural buildings): per-vertex
// aWindow = (stable per-window random, windowLightChance, windowLightIntensity),
// hashed against a per-night seed so a different subset lights each night.
const WINDOW_LIGHTS_UNIFORM = { value: 0 };
const NIGHT_SEED_UNIFORM = { value: 0 };
DEFAULT_EXTERIOR_MATERIAL.onBeforeCompile = (shader) => {
  shader.uniforms.uWindowLights = WINDOW_LIGHTS_UNIFORM;
  shader.uniforms.uNightSeed = NIGHT_SEED_UNIFORM;
  // The hash runs in the VERTEX shader: hashing an interpolated varying per
  // fragment amplifies 1-ulp noise into per-pixel speckle.
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
      attribute vec3 aWindow;
      uniform float uWindowLights;
      uniform float uNightSeed;
      varying float vWindowLit;
      varying float vWindowGlow;`,
    )
    .replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      float winRoll = fract(sin((fract(aWindow.x) * 91.17 + uNightSeed) * 47.53) * 43758.5453);
      float winOrder = winRoll / max(aWindow.y, 1e-3);
      // The last step gates progress == 0: a hash landing exactly on 0 would
      // otherwise satisfy step(winOrder, 0) and glow in daylight.
      vWindowLit = step(1e-4, aWindow.y) * step(winRoll, aWindow.y) * step(winOrder, uWindowLights) * step(1e-4, uWindowLights);
      vWindowGlow = vWindowLit * aWindow.z;`,
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
      // Windows sit 0.05-0.1u proud of the wall, below depth precision a few
      // hundred units out (z-fighting). Pull them toward the camera in view
      // space, scaled with distance. aWindow.x layer: 0 wall, (0,1] frame,
      // (1,2] glass (pulled twice as far — it overlaps the frame).
      if (aWindow.x > 0.0) {
        float winLayer = aWindow.x > 1.0 ? 2.0 : 1.0;
        mvPosition.xyz *= 1.0 - min(-mvPosition.z * 2e-6, 0.003) * winLayer;
        gl_Position = projectionMatrix * mvPosition;
      }`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vWindowLit;\nvarying float vWindowGlow;")
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.78, 0.28), vWindowLit);`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      totalEmissiveRadiance += vec3(1.0, 0.85, 0.1) * vWindowGlow;`,
    );
};

export const DEFAULT_INTERIOR_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });

export const DOOR_MATERIAL = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.9,
  metalness: 0.05,
});

// Applied AFTER the window-lights patch: the patchers chain, and the window
// depth bias recomputes gl_Position from mvPosition, so it must see the
// curved position. Procedural geometry is off the quantization lattice.
prepareActorMaterial(DEFAULT_EXTERIOR_MATERIAL, { skipQuantization: true });
prepareActorMaterial(DOOR_MATERIAL, { skipQuantization: true });
prepareActorMaterial(DEFAULT_INTERIOR_MATERIAL, { skipQuantization: true, skipLampGlow: true });

/** Once per frame: tonight's lit-window subset and how far nightfall has lit it. */
export const updateWindowLightUniforms = (): void => {
  WINDOW_LIGHTS_UNIFORM.value = getWindowLightsProgress();
  NIGHT_SEED_UNIFORM.value = getNightIndex();
};
