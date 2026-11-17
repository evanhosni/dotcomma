import type { PipePiece, ShaftPiece, TunnelPiece } from "../types";

export type FieldFn = (x: number, y: number, z: number) => number;

/** A piece before its bounds are computed (Omit distributed over the union). */
type Unbounded<T> = T extends unknown ? Omit<T, "bounds"> : never;
export type PieceInput = Unbounded<TunnelPiece>;

/** The walkways of a pipe: their levels at each end and how far from each end they run flat. */
export type PipeWalkway = Pick<PipePiece, "floorA" | "floorB" | "flatA" | "flatB">;

export interface FieldOptions {
  /** The probe's view of a closed manhole: its shaft is air only up to SHAFT_CLOSED_BELOW_STREET under the street. */
  shaftOpen?: (shaft: ShaftPiece) => boolean;
  /** The player probe leaves the formations out. */
  withCones?: boolean;
}

export interface RockEscape {
  x: number;
  y: number;
  z: number;
  /** The rock was under or over the point (a floor or ceiling), not beside it. */
  vertical: boolean;
}
