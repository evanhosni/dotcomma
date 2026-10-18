/** The manholes' and doors' open state: per client and per session, keyed by id (a door opened here
 *  stays open through a chunk reload; a reload of the page closes everything). */

const open = new Set<string>();
const listeners = new Set<(id: string, open: boolean) => void>();

export const isOpen = (id: string): boolean => open.has(id);

/** Flips the state and tells the listeners the NEW state. */
export const toggleOpen = (id: string): void => {
  const next = !open.has(id);
  if (next) open.add(id);
  else open.delete(id);
  listeners.forEach((l) => l(id, next));
};

export const onToggle = (listener: (id: string, open: boolean) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
