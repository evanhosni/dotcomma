import { SaveData } from "./types";

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

/** Shallow-merges `patch` into the device save and writes it (callers go through save.ts saveToDevice,
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
