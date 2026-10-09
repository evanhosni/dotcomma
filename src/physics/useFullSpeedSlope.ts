import type Rapier from "@dimforge/rapier3d-compat";
import { RefObject, useEffect } from "react";
import { markFullSpeedSlope } from "./characterMovement";

/** Walk a declarative (R3F) collider at full speed whatever its slope: pass the collider's ref. An
 *  imperative collider calls markFullSpeedSlope itself and runs the returned unmark on removal. */
export const useFullSpeedSlope = (ref: RefObject<Rapier.Collider | null>): void => {
  useEffect(() => (ref.current ? markFullSpeedSlope(ref.current) : undefined), [ref]);
};
