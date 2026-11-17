import type { FieldDisc } from "../types";
import type { PondMount } from "./params";

/** A placed pond: its disc, the biome it stands in, its kind and the key its seeds hang from. */
export interface PondPlace {
  disc: FieldDisc;
  biomeId: number;
  mount: PondMount;
  key: string;
  /** Its roll: the lower wins a clash between neighbours. */
  roll: number;
}
