import * as THREE from "three";
import { FLASH_SIZE, MUZZLE_FLASH_NAME } from "../../weapons/constants";
import { MUZZLE } from "./constants";
import { revolverGeometries } from "./geometry";
import { revolverMaterials } from "./material";

/** One revolver to draw (a hand's, the first-person view's), the PLACEHOLDER until its GLB: the bore along
 *  +z, a hidden flash at its muzzle (weapons/index.ts flashMuzzle). */
export const createRevolver = (): THREE.Group => {
  const g = revolverGeometries();
  const m = revolverMaterials();
  const gun = new THREE.Group();
  gun.name = "revolver";
  gun.add(new THREE.Mesh(g.metal, m.metal), new THREE.Mesh(g.wood, m.wood));
  const flash = new THREE.Sprite(m.flash);
  flash.name = MUZZLE_FLASH_NAME;
  flash.position.set(MUZZLE[0], MUZZLE[1], MUZZLE[2] + FLASH_SIZE * 0.3);
  flash.scale.setScalar(FLASH_SIZE);
  flash.visible = false;
  gun.add(flash);
  return gun;
};
