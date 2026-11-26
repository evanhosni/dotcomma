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
  /** Its host died: no shots taken or fired until it takes another (World.host possess). */
  dead: boolean;
  /** When it last fired (ms): the weapon's rate is the server's. */
  lastShotAt: number;
  /** Server time of the last move: the `st` its snapshots and relayed moves carry. */
  lastMoveAt: number;
}

export interface Outbox {
  send(sessionId: string, msg: ServerMessage): void;
  sendMany(sessionIds: Iterable<string>, msg: ServerMessage, exceptSessionId?: string): void;
}
