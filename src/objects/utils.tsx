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
export const createDefaultsGroup = <T extends object>() => {
  const Context = createContext<T>({} as T);

  const Group = ({ children, ...defaults }: React.PropsWithChildren<T>) => {
    const dataKey = JSON.stringify(defaults);
    const value = useMemo(() => defaults as T, [dataKey]);
    return <Context.Provider value={value}>{children}</Context.Provider>;
  };

  const useDefaults = (): T => useContext(Context);

  return { Group, useDefaults };
};
