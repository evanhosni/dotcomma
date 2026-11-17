export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "offline";

export interface ConnectionState {
  status: ConnectionStatus;
  /** Server-assigned session id; null until init. */
  selfId: string | null;
  color: string | null;
  spawnOffset: { x: number; z: number } | null;
  /** Consecutive failed connection attempts (drives backoff). */
  attempts: number;
}
