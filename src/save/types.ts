import type { DevToggleFlags } from "../context/types";

/** The player's settings. Device-only. */
export interface SaveSettings {
  devmode?: boolean;
}

/** One save, plain JSON, the same shape in both stores (device and account). Every field is optional: a
 *  fresh device or a fresh account has none of them. */
export interface SaveData {
  settings?: SaveSettings;
  /** The devmode checkboxes as last selected, kept while devmode is off. Device-only. */
  devToggles?: Partial<DevToggleFlags>;
}
