import type { PlayerData, DomainId, PlayerSnapshot, ServerMessage } from "../../../src/net/protocol/types";

export interface PersistedPlayer {
  identity: string;
  data: PlayerData;
  /** Connected sessions sharing this identity. */
  sessions: number;
  dirty: boolean;
  savedAt: number;
}

export interface Session extends Omit<PlayerSnapshot, "st"> {
  /** Persistence key — NOT broadcast. */
  identity: string;
  domain: DomainId;
  /** Server time of the last move: the `st` its snapshots and relayed moves carry. */
  lastMoveAt: number;
}

export interface Outbox {
  send(sessionId: string, msg: ServerMessage): void;
  sendMany(sessionIds: Iterable<string>, msg: ServerMessage, exceptSessionId?: string): void;
}
