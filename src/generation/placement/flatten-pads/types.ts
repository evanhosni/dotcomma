export interface FlattenCandidate {
  x: number;
  z: number;
  y: number;
  biomeId: number;
  descIndex: number;
  gx: number;
  gz: number;
}

export interface FlattenPoint {
  x: number;
  z: number;
  y: number; // raw ground height at the center = the pad height
  biomeId: number;
  descId: string;
  radius: number;
  skirt: number;
}
