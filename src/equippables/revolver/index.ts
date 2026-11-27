import type * as THREE from "three";
import { assembleEquippable } from "../utils";
import { MUZZLE } from "./constants";
import { revolverGeometries } from "./geometry";

/** One revolver to draw, the PLACEHOLDER until its GLB: the bore along +z. */
export const createRevolver = (): THREE.Group => assembleEquippable("revolver", revolverGeometries(), MUZZLE);
