import { useSyncExternalStore } from "react";
import { onServerMessage, send } from "./connection";
import { PLAYER_DATA_MAX_BYTES, type PlayerData } from "./protocol";

/**
 * The client side of player persistence: our blob as the server last confirmed it.
 * A patch is applied optimistically and sent; the server's `data` echo always
 * replaces the local copy, so a second tab's change or a refused patch wins.
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

export const playerDataBytes = (d: PlayerData): number => new TextEncoder().encode(JSON.stringify(d)).length;

/** False (nothing sent) before the first init or when the merge would exceed the cap. */
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
