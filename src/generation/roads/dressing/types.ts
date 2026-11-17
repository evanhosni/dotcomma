

export interface CitySitePoint {
  key: string; // biome-grid cell key — stable identity across queries
  x: number;
  y: number; // terrain height at the site
  z: number;
}

export interface CityFreewaySidePoint {
  x: number;
  y: number; // terrain height at the point
  z: number;
  dirX: number; // unit tangent along the freeway
  dirZ: number;
  side: number; // +1 / −1: which side of the centerline (belt: +1 = city side)
  next?: { x: number; y: number; z: number }; // next point along the run (wire spans)
}

export interface RoadMarkerPoint {
  x: number;
  y: number; // terrain height at the marker (curb dip included)
  z: number;
  dirX: number; // unit direction of the road at this marker
  dirZ: number;
}

export type EmitMarker = (mx: number, mz: number, dirX: number, dirZ: number) => void;

export interface FreewayLampParams {
  /** Between two lamps on ONE side (real arc units); the other side is offset by half of it. */
  spacing: number;
  /** Past the painted corridor's outer edge (FREEWAY_CORRIDOR_OUTER), real units: where a lamp stands. */
  verge: number;
  /** Past the corridor's INNER edge (FREEWAY_CORRIDOR_INNER — the curb strip's outer edge), real units:
   *  the fallback on the painted shoulder where the verge lies on the grade's cut or fill ramp. */
  shoulder: number;
  /** No lamp within this arc of a run's end (a hub, or the belt corner a run leaves from). */
  endClear: number;
  /** No lamp within this of a city wall (the belt's centerline) — the city's own lamps take over. */
  beltClear: number;
  /** A lamp's ground within this of the road's (a verge on an embankment or in a cut is not a verge). */
  maxRise: number;
  /** Steepest ground a pole is planted on (degrees). */
  maxSlope: number;
}

export interface FreewayLampPoint {
  x: number;
  y: number;
  z: number;
  /** Local +X (the arm) toward the road. */
  yaw: number;
}

export interface CityTrafficLightPoint {
  x: number;
  y: number; // terrain height at the pole base (sidewalk corner)
  z: number;
  dirX: number; // unit direction the signal head faces (toward the intersection)
  dirZ: number;
  phase: number; // seeded [0,1) — desynchronizes the per-light signal cycles
}
