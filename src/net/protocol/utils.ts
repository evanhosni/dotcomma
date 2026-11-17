import type { DomainId, PlayerData } from "./types";
import { DOMAIN_IDS } from "./enums";

export const isDomainId = (v: unknown): v is DomainId =>
  typeof v === "string" && (DOMAIN_IDS as readonly string[]).includes(v);

/** UTF-8 size of a blob as sent — what PLAYER_DATA_MAX_BYTES caps, measured the same on both sides. */
export const playerDataBytes = (d: PlayerData): number => new TextEncoder().encode(JSON.stringify(d)).length;
