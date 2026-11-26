import * as THREE from "three";
import { chainMaterialPatch } from "../../../vfx/material";
import { prepareActorMaterial } from "../material";
import { BLOOD_RING, MAX_HOLES } from "./constants";

/** A wounded body's blood, darkened into its own colour around each hole. */
const BLOOD_COLOR = "vec3(0.32, 0.0, 0.02)";
const BLOOD_OPACITY = 0.9;

/** One material's holes, as its shader reads them: each one's centre in VIEW space (xyz) and radius (w). */
export interface WoundUniforms {
  uHoles: THREE.IUniform<THREE.Vector4[]>;
  uHoleCount: THREE.IUniform<number>;
}

const HEADER = /* glsl */ `
#define MAX_HOLES ${MAX_HOLES}
uniform vec4 uHoles[MAX_HOLES];
uniform int uHoleCount;
`;

/** Every fragment inside a hole is cut away (the wound's tunnel shows in it, WoundSet.ts); around it the body
 *  is stained with blood. In view space (vViewPosition): no absolute world coordinate is formed. */
const CUT = /* glsl */ `
  float woundBlood = 0.0;
  for (int i = 0; i < MAX_HOLES; i++) {
    if (i >= uHoleCount) break;
    vec4 hole = uHoles[i];
    float d = distance(-vViewPosition, hole.xyz);
    if (d < hole.w) discard;
    woundBlood = max(woundBlood, 1.0 - smoothstep(hole.w, hole.w * ${BLOOD_RING.toFixed(2)}, d));
  }
`;

const STAIN = /* glsl */ `
  gl_FragColor.rgb = mix(gl_FragColor.rgb, ${BLOOD_COLOR}, woundBlood * ${BLOOD_OPACITY.toFixed(2)});
`;

const uniformsOf = new WeakMap<THREE.Material, WoundUniforms>();

/** The wound uniforms of a material patchWounds patched (undefined: it cannot bear wounds). */
export const woundUniformsOf = (material: THREE.Material): WoundUniforms | undefined => uniformsOf.get(material);

/**
 * Lets a lit actor material bear bullet holes (WoundSet.ts writes them). Applied by
 * the actor base to every actor material (prepareActorMaterial): with no wounds the loop never runs. Needs the
 * view position a lit standard material carries; others are left as they are.
 */
export const patchWounds = (material: THREE.Material): void => {
  if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial || uniformsOf.has(material)) return;
  const uniforms: WoundUniforms = {
    uHoles: { value: Array.from({ length: MAX_HOLES }, () => new THREE.Vector4()) },
    uHoleCount: { value: 0 },
  };
  uniformsOf.set(material, uniforms);
  chainMaterialPatch(material, "_wounds", (shader) => {
    shader.uniforms.uHoles = uniforms.uHoles;
    shader.uniforms.uHoleCount = uniforms.uHoleCount;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", HEADER + "void main() {" + CUT)
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>" + STAIN);
  });
};

let tunnel: THREE.MeshStandardMaterial | null = null;

/** The inside of a bullet's way through a body: wet, dark flesh, both faces (it is seen from within), lit as
 *  the body is. One material for every tunnel. */
export const woundTunnelMaterial = (): THREE.MeshStandardMaterial => {
  if (tunnel) return tunnel;
  tunnel = new THREE.MeshStandardMaterial({ color: "#6e0a12", emissive: "#2c0306", roughness: 0.35, metalness: 0, flatShading: true, side: THREE.DoubleSide });
  // Procedural geometry is off the quantization lattice.
  prepareActorMaterial(tunnel, { skipQuantization: true });
  return tunnel;
};
