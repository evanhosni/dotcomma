import * as THREE from "three";
import { patchStandardMaterialLampGlow } from "../../lighting/lamp-glow/material";
import { patchMaterialTunnelLight } from "../../lighting/material";
import { _quantization, _curvature } from "../../vfx/material";
import { _spawnFade } from "../../vfx/spawn-fade";
import { patchWounds } from "./wounds/material";

/**
 * The ONLY place actor materials are patched. Quantization REPLACES project_vertex,
 * the others chain onto it; each patcher is idempotent. The skips are for
 * materials an effect is genuinely wrong for (unlit → no irradiance for lamp glow;
 * procedural geometry is off the quantization lattice). Curvature and the spawn fade
 * have no skip; every lit one can bear bullet holes (wounds/material.ts).
 * `perInstanceSpawnFade`: one mesh drawing many actors' parts (the far doors).
 */
export const prepareActorMaterial = (
  material: THREE.Material,
  options: { quantization?: number; skipQuantization?: boolean; skipLampGlow?: boolean; perInstanceSpawnFade?: boolean } = {},
): void => {
  if (!options.skipQuantization) _quantization.patchMaterial(material, options.quantization);
  if (!options.skipLampGlow) patchStandardMaterialLampGlow(material);
  _curvature.patchMaterial(material);
  _spawnFade.patchMaterial(material, { perInstance: options.perInstanceSpawnFade });
  patchMaterialTunnelLight(material);
  patchWounds(material);
};
