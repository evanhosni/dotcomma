import type * as THREE from "three";
import type { Cut, Vec3Tuple, Wound } from "../../net/protocol/types";

/** A dead player's host, lying where it fell (Corpses.tsx). */
export interface CorpseOrder {
  /** Its id (PlayerDiedMessage `corpse`): shots at it name it. */
  id: string;
  /** The dying body's model, whose pose the corpse starts from (player/registry.ts playerBodyModel). */
  from: THREE.Object3D;
  wounds: Wound[];
  /** The killing shot's direction: the body is thrown along it. */
  dir: Vec3Tuple;
  /** The killing blow's cuts, and the blast it burst from (PlayerDiedMessage). */
  cuts: Cut[];
  gib?: Vec3Tuple;
}

/** A mounted corpse's part of the shared frame. */
export type CorpseStep = () => void;
