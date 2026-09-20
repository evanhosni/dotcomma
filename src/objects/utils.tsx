import React, { createContext, useContext, useMemo } from "react";

/** Group-defaults factory behind <Dressing>/<Foliage>: props on the group are
 *  defaults for the children, a child's own props win. (<Actors> keeps its own
 *  variant — its defaults carry a non-serializable `component`.) */
export const createDefaultsGroup = <T extends object>(className: string) => {
  const Context = createContext<T>({} as T);

  const Group = ({ children, ...defaults }: React.PropsWithChildren<T>) => {
    const dataKey = JSON.stringify(defaults);
    const value = useMemo(() => defaults as T, [dataKey]);
    warnUnsupportedSync(className, (defaults as { serverSynced?: boolean }).serverSynced);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };

  const useDefaults = (): T => useContext(Context);

  return { Group, useDefaults };
};

const syncWarned = new Set<string>();
/** Dressing and foliage have no sync (deterministic scenery every client already agrees on). */
export const warnUnsupportedSync = (className: string, serverSynced: boolean | undefined): void => {
  if (serverSynced !== true || syncWarned.has(className)) return;
  syncWarned.add(className);
  console.warn(`[sync] serverSynced is not implemented for ${className} (stateless scenery — every client already agrees); ignoring`);
};
