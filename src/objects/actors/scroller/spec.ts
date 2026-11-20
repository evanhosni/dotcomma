import type { VehicleShape } from "../../../physics/vehicle/types";
import type { ActorSpec } from "../spec";

/** The SCROLLER: a car shaped like a triangular computer mouse, driven by one big scroll wheel that
 *  pokes up through its hood (two small feet-wheels hide under the tail). Parked along the curb of
 *  city streets; the player clicks one to get in (objects/actors/scroller/Scroller.tsx).
 *
 *  Not server-synced yet: every client parks the same cars (placement is deterministic), but a car
 *  someone drives moves only on their screen. */
export const SCROLLER_SPEC: ActorSpec = {
  id: "scroller",
  component: "scroller",
  serverSynced: false,
  // The right-hand lane, between its middle and the curb (normalized street units: the curb is at 7).
  roadDistanceRange: [3.6, 5.4],
  footprint: 14,
  density: 2500,
  clustering: 0.3,
  renderDistance: 250,
  frustumPadding: 1.5,
  priority: 60,
  interactReach: 7,
};

/** The body frame: +z is forward, +y up, and the ground sits at y = 0 when the car rests on its wheels. */
export const SCROLLER_HULL: ReadonlyArray<readonly [number, number, number]> = [
  // the floor outline: wide at the tail, pointed at the nose
  [-1.15, 0.5, -2.2], [1.15, 0.5, -2.2],
  [-1.3, 0.5, -1.3], [1.3, 0.5, -1.3],
  [-0.75, 0.5, 1.5], [0.75, 0.5, 1.5],
  [-0.35, 0.5, 2.2], [0.35, 0.5, 2.2],
  // the shoulders
  [-0.95, 1.15, -2.0], [0.95, 1.15, -2.0],
  [-1.1, 1.35, -1.1], [1.1, 1.35, -1.1],
  [-0.6, 0.9, 1.3], [0.6, 0.9, 1.3],
  [-0.25, 0.8, 2.15], [0.25, 0.8, 2.15],
  // the spine: the palm hump toward the tail, sloping down to the nose
  [0, 1.35, -2.15], [0, 1.7, -1.0], [0, 1.5, 0], [0, 1.0, 1.2], [0, 0.85, 2.1],
];

const FRONT_WHEEL_RADIUS = 0.8;
const REAR_WHEEL_RADIUS = 0.4;
/** Spring travel; at rest a quarter of it is compressed (physics/vehicle/constants.ts SPRING_RATE). */
const SUSPENSION_LENGTH = 0.7;
const REST_SUSPENSION = SUSPENSION_LENGTH - 0.25;

export const FRONT_WHEEL_WIDTH = 0.5;
export const REAR_WHEEL_WIDTH = 0.3;

/** Mounted so every wheel touches y = 0 at rest. */
export const SCROLLER_SHAPE: VehicleShape = {
  suspensionLength: SUSPENSION_LENGTH,
  wheels: [
    { x: 0, y: FRONT_WHEEL_RADIUS + REST_SUSPENSION, z: 1.35, radius: FRONT_WHEEL_RADIUS, steers: true, driven: true, rear: false },
    { x: 0.95, y: REAR_WHEEL_RADIUS + REST_SUSPENSION, z: -1.5, radius: REAR_WHEEL_RADIUS, steers: false, driven: true, rear: true },
    { x: -0.95, y: REAR_WHEEL_RADIUS + REST_SUSPENSION, z: -1.5, radius: REAR_WHEEL_RADIUS, steers: false, driven: true, rear: true },
  ],
};

export const SCROLLER_MASS = 30;
/** Under the wheels' centroid (equal load on the three) and low: hard corners lean, rarely tip. */
export const SCROLLER_CENTER_OF_MASS = { x: 0, y: 0.6, z: -0.55 };
/** Pitch, yaw, roll about the center of mass: a 2.4 × 1.2 × 4.4 box's, roll raised to resist tipping. */
export const SCROLLER_INERTIA = { x: 52, y: 70, z: 30 };

/** Where the driver sits (and the chase camera aims), in the body frame. */
export const SCROLLER_SEAT = { x: 0, y: 1.3, z: -0.6 };
