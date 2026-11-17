import { PLAYER_DATA_MAX_BYTES } from "../../../src/net/protocol/constants";
import { playerDataBytes } from "../../../src/net/protocol/utils";
import type { PlayerData } from "../../../src/net/protocol/types";

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The merged blob when `patch` is a plain object whose merge fits the cap, else null. */
export const validatePatch = (current: PlayerData, patch: unknown): PlayerData | null => {
  if (!isPlainObject(patch)) return null;
  const merged = { ...current, ...patch };
  if (playerDataBytes(merged) > PLAYER_DATA_MAX_BYTES) return null;
  return merged;
};
