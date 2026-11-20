import type { Vehicle } from "../physics/vehicle/types";

/** A car in the world with a body: the driver steps it while it is awake, and the player can sit in it. */
export interface LiveVehicle {
  /** The actor id. */
  id: string;
  /** Shown on the HUD. */
  name: string;
  /** The HUD's swatch. */
  color: string;
  vehicle: Vehicle;
  /** Where the driver sits, in the body frame (+z forward). */
  seat: { x: number; y: number; z: number };
}

export interface DriveInput {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  handbrake: boolean;
  /** Set by a fresh press of the exit key, cleared by whoever acts on it. */
  exitPressed: boolean;
}

/** The chase camera's state between frames. */
export interface ChaseCamera {
  /** Smoothed heading the camera trails (radians, atan2(x, z)). */
  yaw: number;
  /** Mouse orbit on top of it. */
  orbitYaw: number;
  orbitPitch: number;
  /** performance.now() of the last mouse move. */
  lastMouse: number;
  /** Smoothed boom length. */
  distance: number;
  /** False until the first frame in a car places it outright. */
  placed: boolean;
}
