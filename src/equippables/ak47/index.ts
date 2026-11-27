import type * as THREE from "three";
import { assembleEquippable } from "../utils";
import { MUZZLE } from "./constants";
import { ak47Geometries } from "./geometry";

/** One AK-47 to draw, the PLACEHOLDER until its GLB: the bore along +z. */
export const createAk47 = (): THREE.Group => assembleEquippable("ak47", ak47Geometries(), MUZZLE);
