import type Rapier from "@dimforge/rapier3d-compat";
import type { RapierRuntime } from "../types";

/** What makes one car drive differently from another (objects/actors/scroller/utils.ts rolls them). */
export interface VehicleStats {
  /** u/s on a road. */
  topSpeed: number;
  /** u/s² of engine pull from a standstill (it fades toward topSpeed). */
  acceleration: number;
  /** u/s² of the foot brake. */
  braking: number;
  /** 0..1: tire grip and how far the wheel turns. */
  handling: number;
  /** 0..1: how much grip and speed the car keeps off the road. */
  offRoad: number;
}

/** One ray-cast wheel, in the body's frame (+z forward, +y up, the ground at y = 0 when resting). */
export interface WheelSpec {
  x: number;
  y: number;
  z: number;
  radius: number;
  steers: boolean;
  driven: boolean;
  /** Locked by the handbrake, and the end that slides out in a drift. */
  rear: boolean;
}

export interface VehicleShape {
  wheels: WheelSpec[];
  /** Spring travel: the mount to the wheel's center at full extension. */
  suspensionLength: number;
}

export interface VehicleInput {
  /** +1 accelerate, −1 brake then reverse. */
  throttle: number;
  /** +1 right, −1 left. */
  steer: number;
  handbrake: boolean;
}

/** Per wheel, rewritten every step; the renderer reads it. */
export interface WheelState {
  /** Mount → wheel center, along the body's down axis. */
  suspension: number;
  compression: number;
  grounded: boolean;
  /** Radians the wheel has rolled. */
  spin: number;
}

export interface VehicleState {
  /** Radians the steered wheels are turned (smoothed). */
  steer: number;
  wheels: WheelState[];
  groundedWheels: number;
  /** Forward speed, u/s (negative reversing). */
  forwardSpeed: number;
  /** Set by the caller from a worker sample of the ground (on a road, or off it). */
  onRoad: boolean;
  /** Seconds spent upside-down and nearly still. */
  flippedFor: number;
}

export interface Vehicle {
  body: Rapier.RigidBody;
  shape: VehicleShape;
  stats: VehicleStats;
  state: VehicleState;
  ray: Rapier.Ray;
}

export type { RapierRuntime };
