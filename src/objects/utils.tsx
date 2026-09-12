import React, { createContext, useContext, useMemo } from "react";

/**
 * Shared group-defaults pattern for the game-object classes' group
 * components (<Dressing>, <Foliage> — <Actors> keeps its own variant because
 * its defaults carry a non-serializable `component`): props set on the group
 * act as shared defaults for the children — a child's own props always win.
 *
 * The context value is memoized under stringified props so parent re-renders
 * with inline literals don't churn child registrations.
 */
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
/**
 * `serverSynced` is a base attribute of every game-object class
 * (objects/types.ts). Dressing and foliage default to FALSE and have no sync
 * implementation: both are stateless, deterministic scenery that every client
 * already computes identically, so there is nothing to publish. A mount that
 * asks for it gets one warning per class instead of silent acceptance.
 */
export const warnUnsupportedSync = (className: string, serverSynced: boolean | undefined): void => {
  if (serverSynced !== true || syncWarned.has(className)) return;
  syncWarned.add(className);
  console.warn(`[sync] serverSynced is not implemented for ${className} (stateless scenery — every client already agrees); ignoring`);
};
