import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { FLASH_SIZE, MUZZLE_FLASH_NAME } from "../weapons/constants";
import { equippableMaterials } from "./material";

export type EquippableLook = Exclude<keyof ReturnType<typeof equippableMaterials>, "flash">;

/** Placeholder shapes in one geometry per look (one draw each). */
export const mergeParts = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => mergeGeometries(parts.map((g) => g.toNonIndexed()))!;

/** One model to draw (a hand's, the first-person view's) from its merged shapes by look, with a hidden flash
 *  at its `muzzle` when it fires one (weapons/index.ts flashMuzzle). */
export const assembleEquippable = (
  name: string,
  shapes: Partial<Record<EquippableLook, THREE.BufferGeometry>>,
  muzzle?: readonly [number, number, number],
): THREE.Group => {
  const m = equippableMaterials();
  const item = new THREE.Group();
  item.name = name;
  for (const [look, geometry] of Object.entries(shapes) as [EquippableLook, THREE.BufferGeometry][]) item.add(new THREE.Mesh(geometry, m[look]));
  if (muzzle) {
    const flash = new THREE.Sprite(m.flash);
    flash.name = MUZZLE_FLASH_NAME;
    flash.position.set(muzzle[0], muzzle[1], muzzle[2] + FLASH_SIZE * 0.3);
    flash.scale.setScalar(FLASH_SIZE);
    flash.visible = false;
    item.add(flash);
  }
  return item;
};
