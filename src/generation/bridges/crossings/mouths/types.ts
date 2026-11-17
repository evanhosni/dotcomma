import type { CrossingGeom, Mouth } from "../../types";

/** A mouth left over after the pairing, teeing into a pair's deck. */
interface MouthBranch {
  mouth: Mouth;
  trunk: MouthPair;
  geom: CrossingGeom;
}

export interface MouthPair {
  mouths: [Mouth, Mouth];
  geom: CrossingGeom;
}

export interface EdgeMouths {
  mouths: Mouth[];
  pairs: MouthPair[];
  branches: MouthBranch[];
  /** Every mouth with the mouths it faces across the river, best first: where no pair or branch
   *  serves it, it tees into the NATURAL deck of the first of them one lands at (a road's own deck is
   *  decided in the window, so this one is too — bridgesInWindow's resolveNatural). */
  naturals: { mouth: Mouth; faces: Mouth[] }[];
}
