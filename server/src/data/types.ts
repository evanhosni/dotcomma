import type { DatabaseSync } from "node:sqlite";
import type { PlayerData } from "../../../src/net/protocol/types";

export interface Migration {
  /** For the log only — the INDEX is the version. */
  name: string;
  up(db: DatabaseSync): void;
}

/** A type alias, not an interface: aliases get an implicit index signature, which
 *  makes the cast from node:sqlite's Record<string, SQLOutputValue> legal. */
export type PlayerRow = {
  id: string;
  data: string;
  created_at: number;
  updated_at: number;
};

export interface PlayerRecord {
  id: string;
  data: PlayerData;
  createdAt: number;
  updatedAt: number;
}
