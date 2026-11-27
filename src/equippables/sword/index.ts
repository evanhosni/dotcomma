import type * as THREE from "three";
import { assembleEquippable } from "../utils";
import { swordGeometries } from "./geometry";

/** One sword to draw, the PLACEHOLDER until its GLB: the blade along +z. */
export const createSword = (): THREE.Group => assembleEquippable("sword", swordGeometries());
