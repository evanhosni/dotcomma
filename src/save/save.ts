import { useSyncExternalStore } from "react";
import { subscribePlayerData } from "../net/playerData";
import { getAccountSave } from "./accountSave";
import { getDeviceSave, writeDeviceSave } from "./deviceSave";
import { SaveData } from "./types";

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
export { saveToAccount } from "./accountSave";
