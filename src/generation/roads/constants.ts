/** The road field and the lane-paint distance (VertexResult.distanceToRoadCenter /
 *  distanceToFreewayCenter) where no road, or no lane paint, is near. */
export const NO_ROAD_DISTANCE = 99999;

/** On the river side of a quay road the field keeps growing to this, well past the plaza band: a
 *  cap AT the plaza band zig-zags the interpolated sand/pavement edge with the terrain vertices.
 *  Buildings stay off the bank through the placement filter's river exclusion. */
export const CITY_QUAY_INNER_CAP = 60;

// The ×(roadWidth/freewayWidth) squash applies up to this normalized value (just past the interior
// band at 12), then the field recovers at the steep slope, so the blocks along an arterial are not
// all setback (no building band).
export const CITY_ARTERIAL_RECOVER_NORM = 12.2;
export const CITY_ARTERIAL_RECOVER_SLOPE = 3;
/** The belt's recovery start (normalized): 9.5 = 19u real, one curb strip past its asphalt. */
export const CITY_BELT_RECOVER_NORM = 9.5;
