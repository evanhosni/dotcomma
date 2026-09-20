import React, { createContext, useContext, useMemo } from "react";

/** Group props = shared defaults for the children (a child's own props win). <Actors> keeps its
 *  own variant because its defaults carry a non-serializable `component`. Memoized under the
 *  stringified props so inline literals at the mount don't churn child registrations. */
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
