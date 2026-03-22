import { createContext, useCallback, useContext, useMemo, useState } from "react";

export const PARAM_DEFINITIONS = {
  overlay: "Performance Overlay",
  dev: "Dev Mode",
  debug: "Physics Debug",
  quantize: "Vertex Quantization",
} as const;

export type ParamKey = keyof typeof PARAM_DEFINITIONS;

const PARAM_KEYS = Object.keys(PARAM_DEFINITIONS) as ParamKey[];

interface UrlParametersState {
  params: Record<ParamKey, boolean>;
  paletteOpen: boolean;
  toggle: (key: ParamKey) => void;
  setPaletteOpen: (open: boolean) => void;
}

const UrlParametersContext = createContext<UrlParametersState>(null!);

function readParams(): Record<ParamKey, boolean> {
  const search = new URLSearchParams(window.location.search);
  const result = {} as Record<ParamKey, boolean>;
  for (const key of PARAM_KEYS) {
    result[key] = search.has(key);
  }
  return result;
}

function writeParams(params: Record<ParamKey, boolean>) {
  const search = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    if (params[key]) search.set(key, "true");
  }
  const qs = search.toString();
  const url = window.location.pathname + (qs ? `?${qs}` : "");
  window.history.replaceState(null, "", url);
}

export const UrlParametersProvider = ({ children }: { children: React.ReactNode }) => {
  const [params, setParams] = useState<Record<ParamKey, boolean>>(readParams);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggle = useCallback((key: ParamKey) => {
    setParams((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeParams(next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ params, paletteOpen, toggle, setPaletteOpen }),
    [params, paletteOpen, toggle]
  );

  return <UrlParametersContext.Provider value={value}>{children}</UrlParametersContext.Provider>;
};

export const useUrlParameters = () => useContext(UrlParametersContext);
