import type { LiveVehicle } from "./types";

/** Every car with a body, stepped by the one VehicleDriver while awake. */
const live = new Set<LiveVehicle>();
let seated: LiveVehicle | null = null;
/** Where the player steps out, set on leaving and taken once by the Player. */
let exitPoint: { x: number; y: number; z: number } | null = null;
const seatListeners = new Set<() => void>();

const notifySeat = (): void => seatListeners.forEach((listener) => listener());

export const liveVehicles = (): ReadonlySet<LiveVehicle> => live;

export const registerVehicle = (vehicle: LiveVehicle): void => {
  live.add(vehicle);
};

/** Call BEFORE removing its body: a car unmounted with the player in it puts them out where it stood. */
export const unregisterVehicle = (vehicle: LiveVehicle): void => {
  live.delete(vehicle);
  if (seated !== vehicle) return;
  const at = vehicle.vehicle.body.translation();
  leaveVehicle({ x: at.x, y: at.y + 3, z: at.z });
};

export const getSeatedVehicle = (): LiveVehicle | null => seated;

export const enterVehicle = (vehicle: LiveVehicle): void => {
  if (seated || !live.has(vehicle)) return;
  seated = vehicle;
  exitPoint = null;
  vehicle.vehicle.body.wakeUp();
  notifySeat();
};

/** `at`: the player's body CENTER once out. */
export const leaveVehicle = (at: { x: number; y: number; z: number }): void => {
  if (!seated) return;
  seated = null;
  exitPoint = at;
  notifySeat();
};

export const takeExitPoint = (): { x: number; y: number; z: number } | null => {
  const at = exitPoint;
  exitPoint = null;
  return at;
};

export const onSeatChange = (listener: () => void): (() => void) => {
  seatListeners.add(listener);
  return () => seatListeners.delete(listener);
};
