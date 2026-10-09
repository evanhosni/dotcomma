import type { DevToggleFlags } from "../context/types";

/** One save, plain JSON, the same shape in both stores (device and account). Every field is optional: a
 *  fresh device or a fresh account has none of them. */
export interface SaveData {
  /** The devmode checkboxes as last selected, kept while devmode is off. Device-only. */
  devmode?: Partial<DevToggleFlags>;
}
