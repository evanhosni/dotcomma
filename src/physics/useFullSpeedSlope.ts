import type Rapier from "@dimforge/rapier3d-compat";
import { RefObject, useEffect } from "react";
import { markFullSpeedSlope } from "./characterMovement";

/** Walk a declarative (R3F) collider at full speed whatever its slope: pass the collider's ref (set by
 *  the time this effect runs: @react-three/rapier creates a collider in its own, child, effect). An
 *  imperative collider calls markFullSpeedSlope on the collider it creates. */
export const useFullSpeedSlope = (ref: RefObject<Rapier.Collider | null>): void => {
  useEffect(() => {
    if (ref.current) markFullSpeedSlope(ref.current);
  }, [ref]);
};
