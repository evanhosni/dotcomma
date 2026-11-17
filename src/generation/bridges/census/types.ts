import type { RoadPath } from "../types";

/** A freeway connection the water severs: a wet stretch of a freeway (its centerline yields to the
 *  river, as the terrain has it) that nothing carries across. */
export interface SeveredFreeway {
  x: number;
  z: number;
  kind: RoadPath["kind"];
  /** Real length of the stretch's uncarried samples. */
  length: number;
  /** The stretch: crosses a river bank to bank ("cross"), grazes one and leaves on the bank it came
   *  from ("graze"), or the road ends in it at a junction across the river ("open"). */
  shape: "cross" | "graze" | "open";
  city: boolean;
}
