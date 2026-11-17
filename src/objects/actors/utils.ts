import { framePhaseFromCoords } from "../../utils/utils";

/** An instance's shift of every frame-rate grid (drawn movement, animation): spread over a second, so a crowd
 *  never steps on one frame, and shared, so equal rates step body and pose together. */
export const framePhaseMsOf = (coordinates: readonly number[]): number => framePhaseFromCoords(coordinates[0], coordinates[2], 1000);

/** A distance gate with hysteresis: once active it holds out to `gateDistance + hysteresis`, so it can't flicker. */
export const withinGate = (distanceSq: number, gateDistance: number, active: boolean, hysteresis: number): boolean => {
  const reach = gateDistance + (active ? hysteresis : 0);
  return distanceSq < reach * reach;
};
