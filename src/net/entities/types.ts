import type { EntityUpdateFields } from "../protocol/types";

export interface Snapshot {
  /** Server time (ms) of the publishing tick. */
  st: number;
  x: number;
  y: number;
  z: number;
  ry: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SampledPose {
  x: number;
  y: number;
  z: number;
  ry: number;
  /** Velocity of the segment being played back (u/s). */
  vx: number;
  vy: number;
  vz: number;
}

export type SampleStatus = "none" | "hold" | "interpolated" | "extrapolated";

/** The server's fields for one entity, merged across updates. */
export type RemoteFields = EntityUpdateFields;

export interface ClientEntity {
  id: string;
  kind: string;
  origin: { x: number; y: number; z: number };
  /** null until the server has acknowledged the registration. */
  remote: RemoteFields | null;
  /** Server-time-stamped positional track, oldest first (net/entities/utils.ts). */
  snapshots: Snapshot[];
  listeners: Set<(e: ClientEntity) => void>;
}

export interface PuppetTarget {
  valid: boolean;
  x: number;
  y: number;
  z: number;
  ry: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface SyncHandle {
  readonly id: string;
  readonly entity: ClientEntity | undefined;
  /** False until the server has acknowledged the registration (the actor sits at spawn). */
  readonly known: boolean;
  readonly target: PuppetTarget;
  /** Server-owned; toggled via interact(). */
  readonly state: Record<string, unknown> | undefined;
  /** The server-side machine's current state id. */
  readonly stateId: string | undefined;
  interact(action: string): void;
  /** Fires on state / clip / machine-state changes only. */
  subscribe(fn: (e: ClientEntity) => void): () => void;
}
