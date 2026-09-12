import { useSyncExternalStore } from "react";
import { onServerMessage, send } from "./connection";
import { PLAYER_DATA_MAX_BYTES, type PlayerData } from "./protocol";

/**
 * PLAYER DATA — the client side of persistence. YOUR persisted blob
 * (settings, progress — see PlayerData in protocol.ts for its shape as it
 * grows), as the server last confirmed it.
 *
 *   getPlayerData()          the blob (null until the first init)
 *   usePlayerData()          React subscription (UI cadence)
 *   updatePlayerData(patch)  shallow-merge a change: applied here at once,
 *                            sent as `data:patch`; the server merges, marks
 *                            dirty (saved per its write policy) and echoes the
 *                            merged blob to every tab of this identity.
 *
 * The server is the record: a `data` message from it always replaces the
 * local copy (so a second tab's change, or a rejected oversized patch, wins
 * over the optimistic local merge). Size is capped on both sides — a patch
 * that would push the blob past PLAYER_DATA_MAX_BYTES is refused here and
 * never sent.
 */

let data: PlayerData | null = null;
const listeners = new Set<() => void>();

const setData = (next: PlayerData | null): void => {
  data = next;
  listeners.forEach((l) => l());
};

export const getPlayerData = (): PlayerData | null => data;

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const usePlayerData = (): PlayerData | null => useSyncExternalStore(subscribe, getPlayerData);
export const onPlayerDataChange = subscribe;

/** Serialized size of a blob — the cap the server also enforces. */
export const playerDataBytes = (d: PlayerData): number => new TextEncoder().encode(JSON.stringify(d)).length;

/** Shallow-merge `patch` into the blob. Returns false (nothing sent) when
 *  offline before the first init, or when the result would exceed the cap. */
export const updatePlayerData = (patch: PlayerData): boolean => {
  if (data === null) return false;
  const merged = { ...data, ...patch };
  if (playerDataBytes(merged) > PLAYER_DATA_MAX_BYTES) {
    console.warn(`[net] player data patch refused: blob would exceed ${PLAYER_DATA_MAX_BYTES} bytes`);
    return false;
  }
  if (!send({ t: "data:patch", patch })) return false;
  setData(merged);
  return true;
};

onServerMessage((msg) => {
  if (msg.t === "init" || msg.t === "data") setData(msg.data);
});

// Console access: __playerData.data, __playerData.update({...})
(window as unknown as { __playerData: unknown }).__playerData = {
  get data() {
    return data;
  },
  update: updatePlayerData,
};
