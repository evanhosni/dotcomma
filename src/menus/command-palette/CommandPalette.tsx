import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PARAM_DEFINITIONS, ParamKey, useUrlParameters } from "../../context/UrlParametersContext";

const PARAM_ENTRIES = Object.entries(PARAM_DEFINITIONS) as [ParamKey, string][];

const styles = {
  backdrop: {
    position: "fixed" as const,
    inset: 0,
    zIndex: 9999,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "flex-start" as const,
    justifyContent: "center" as const,
    paddingTop: "20vh",
  },
  panel: {
    background: "rgba(0,0,0,0.85)",
    borderRadius: 4,
    padding: "8px 12px",
    minWidth: 260,
    fontFamily: "'Kode Mono','Courier New',Courier,monospace",
    fontSize: 12,
    color: "#0f0",
  },
  input: {
    width: "100%",
    background: "transparent",
    border: "none",
    borderBottom: "1px solid #0f0",
    color: "#0f0",
    fontFamily: "inherit",
    fontSize: "inherit",
    outline: "none",
    padding: "4px 0",
    marginBottom: 4,
    boxSizing: "border-box" as const,
  },
  item: (selected: boolean) => ({
    padding: "4px 8px",
    borderRadius: 2,
    cursor: "pointer" as const,
    background: selected ? "rgba(0,255,0,0.15)" : "transparent",
    display: "flex" as const,
    justifyContent: "space-between" as const,
  }),
};

export const CommandPalette = () => {
  const { params, paletteOpen, toggle, setPaletteOpen } = useUrlParameters();
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!filter) return PARAM_ENTRIES;
    const lower = filter.toLowerCase();
    return PARAM_ENTRIES.filter(
      ([key, label]) => key.toLowerCase().includes(lower) || label.toLowerCase().includes(lower)
    );
  }, [filter]);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  const close = useCallback(() => {
    setPaletteOpen(false);
    setFilter("");
    setSelectedIndex(0);
  }, [setPaletteOpen]);

  // Global F1 listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "F1") {
        e.preventDefault();
        if (paletteOpen) {
          close();
        } else {
          document.exitPointerLock();
          setPaletteOpen(true);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [paletteOpen, close, setPaletteOpen]);

  // Auto-focus input when opened
  useEffect(() => {
    if (paletteOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [paletteOpen]);

  if (!paletteOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        toggle(filtered[selectedIndex][0]);
      }
    }
  };

  return (
    <div style={styles.backdrop} onClick={close}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          style={styles.input}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search params..."
        />
        {filtered.map(([key, label], i) => (
          <div
            key={key}
            style={styles.item(i === selectedIndex)}
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => toggle(key)}
          >
            <span>
              {key} — {label}
            </span>
            <span>{params[key] ? "✓" : ""}</span>
          </div>
        ))}
        {filtered.length === 0 && <div style={{ padding: "4px 8px", opacity: 0.5 }}>No matches</div>}
      </div>
    </div>
  );
};
