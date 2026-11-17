import { getSave, saveToDevice } from "../save/store";
import { DEV_TOGGLES } from "./constants";
import { DevToggleFlags } from "./types";

export const ALL_TOGGLES_OFF = Object.fromEntries(DEV_TOGGLES.map(({ flag }) => [flag, false])) as DevToggleFlags;

/** Only the known flags, only booleans: a stale or hand-edited save can't inject anything else. */
export const togglesFromSave = (saved: Partial<DevToggleFlags> | undefined): DevToggleFlags => {
  const toggles = { ...ALL_TOGGLES_OFF };
  for (const { flag } of DEV_TOGGLES) if (typeof saved?.[flag] === "boolean") toggles[flag] = saved[flag]!;
  return toggles;
};

const DEV_PARAM = "devmode";

/** Boot: the URL decides devmode. `?devmode=true` turns it on; any other value, or no param, turns it off;
 *  the device save follows (save/: settings.devmode). From then on the setting writes the URL back. */
export const initDevmodeFromUrl = (): void => {
  const on = new URLSearchParams(window.location.search).get(DEV_PARAM) === "true";
  if ((getSave().settings?.devmode === true) !== on) saveToDevice({ settings: { ...getSave().settings, devmode: on } });
};

export const setDevMode = (on: boolean): void => saveToDevice({ settings: { ...getSave().settings, devmode: on } });

/** The URL follows the setting (replaceState: the back trap's entries stay what they were). */
export const writeDevmodeToUrl = (on: boolean): void => {
  const url = new URL(window.location.href);
  const synced = on ? url.searchParams.get(DEV_PARAM) === "true" : !url.searchParams.has(DEV_PARAM);
  if (synced) return;
  if (on) url.searchParams.set(DEV_PARAM, "true");
  else url.searchParams.delete(DEV_PARAM);
  window.history.replaceState(window.history.state, "", url);
};
