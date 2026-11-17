import { getPlayerData, updatePlayerData, subscribePlayerData } from "../net/store";
import { SaveData } from "./types";
import { useSyncExternalStore } from "react";

/** "Save to account": the hosted database, which is the server-persisted player blob
 *  (net/store.ts) keyed by this browser's identity. It arrives with the server's `init` after the
 *  connection opens — never synchronously at boot. */

/** Null until the server has sent it. */
export const getAccountSave = (): SaveData | null => getPlayerData() as SaveData | null;

/** False when nothing was sent (not connected yet, or over the size cap). */
export const saveToAccount = (patch: SaveData): boolean => updatePlayerData(patch as Record<string, unknown>);

/** "Save to device": one JSON object in localStorage. */

const DEVICE_SAVE_KEY = "dotcomma:save";

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const read = (): SaveData => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(DEVICE_SAVE_KEY) ?? "{}");
    return isPlainObject(parsed) ? (parsed as SaveData) : {};
  } catch {
    return {}; // storage blocked (privacy mode) or a corrupt blob: start empty, never throw at boot
  }
};

let deviceSave: SaveData = read();

export const getDeviceSave = (): SaveData => deviceSave;

/** Shallow-merges `patch` into the device save and writes it (callers go through save/store.ts saveToDevice,
 *  which also refreshes the merged view). Kept in memory even when storage is
 *  unavailable, so the session still behaves. */
export const writeDeviceSave = (patch: SaveData): void => {
  deviceSave = { ...deviceSave, ...patch };
  try {
    window.localStorage.setItem(DEVICE_SAVE_KEY, JSON.stringify(deviceSave));
  } catch {
    // quota or privacy mode: the in-memory copy is all there is this session
  }
};

/**
 * The loaded save: the account save (hosted db) under the device save (localStorage). The device
 * copy is read synchronously at boot; the account copy lands when the server's `init` arrives, and
 * this view updates then. Where both hold a field, the DEVICE wins — it is the newer, local choice.
 */

const listeners = new Set<() => void>();
let merged: SaveData = getDeviceSave();

const remerge = (): void => {
  merged = { ...(getAccountSave() ?? {}), ...getDeviceSave() };
  listeners.forEach((l) => l());
};
subscribePlayerData(remerge);

export const getSave = (): SaveData => merged;

const subscribeSave = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const useSave = (): SaveData => useSyncExternalStore(subscribeSave, getSave);

/** Save to device (localStorage); every useSave() re-renders. */
export const saveToDevice = (patch: SaveData): void => {
  writeDeviceSave(patch);
  remerge();
};

/** Save to account (the hosted db). Nothing calls it yet: no field is account-scoped so far. */
