/** A kind of piece on its own lattice. `stays`: whether a small piece is kept anyway. */
export interface PieceLattice {
  cell: number;
  maxCells: number;
  land: (x: number, z: number) => number;
  stays: (piece: number[]) => boolean;
  verdicts: Map<number, number>;
}
