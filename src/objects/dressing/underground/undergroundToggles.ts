import { onServerMessage, send } from "../../../net/connection";

/** The manholes' and doors' open state, by id: the SERVER's, per domain (it drops its NPCs down the same
 *  open manholes), mirrored here from the room's `init` and every `tunnel:state`. A click asks the server;
 *  offline it flips here alone. */

const open = new Set<string>();
const listeners = new Set<(id: string, open: boolean) => void>();

export const isOpen = (id: string): boolean => open.has(id);

/** Sets the state and tells the listeners the NEW state when it changed. */
const setOpen = (id: string, next: boolean): void => {
  if (open.has(id) === next) return;
  if (next) open.add(id);
  else open.delete(id);
  listeners.forEach((l) => l(id, next));
};

export const toggleOpen = (id: string): void => {
  if (!send({ t: "tunnel:toggle", id })) setOpen(id, !open.has(id));
};

export const onToggle = (listener: (id: string, open: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

onServerMessage((msg) => {
  if (msg.t === "tunnel:state") {
    setOpen(msg.id, msg.open);
  } else if (msg.t === "init") {
    const now = new Set(msg.tunnelsOpen);
    for (const id of [...open]) if (!now.has(id)) setOpen(id, false);
    for (const id of now) setOpen(id, true);
  }
});
