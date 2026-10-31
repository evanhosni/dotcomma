/** The entries of `props` that are set — so an unset prop never shadows a default it is spread over. */
export const definedOnly = <T extends object>(props: T): Partial<T> =>
  Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as Partial<T>;

const syncWarned = new Set<string>();
/** Dressing and foliage have no sync (deterministic scenery every client already agrees on). */
export const warnUnsupportedSync = (className: string, serverSynced: boolean | undefined): void => {
  if (serverSynced !== true || syncWarned.has(className)) return;
  syncWarned.add(className);
  console.warn(`[sync] serverSynced is not implemented for ${className} (stateless scenery — every client already agrees); ignoring`);
};
