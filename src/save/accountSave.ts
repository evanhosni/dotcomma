import { getPlayerData, updatePlayerData } from "../net/playerData";
import { SaveData } from "./types";

/** "Save to account": the hosted database, which is the server-persisted player blob
 *  (net/playerData.ts) keyed by this browser's identity. It arrives with the server's `init` after the
 *  connection opens — never synchronously at boot. */

/** Null until the server has sent it. */
export const getAccountSave = (): SaveData | null => getPlayerData() as SaveData | null;

/** False when nothing was sent (not connected yet, or over the size cap). */
export const saveToAccount = (patch: SaveData): boolean => updatePlayerData(patch as Record<string, unknown>);
