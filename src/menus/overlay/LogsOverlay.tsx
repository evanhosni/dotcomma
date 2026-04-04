import { useEffect, useRef } from "react";
import { useDevMode } from "../../context/DevContext";

const EXPIRE_MS = 30_000;
const CHECK_INTERVAL_MS = 1_000;

type LogLevel = "log" | "error" | "warn";

const LOG_COLORS: Record<LogLevel, string> = {
  log: "#0f0",
  error: "#f44",
  warn: "#fa0",
};

const BADGE_COLORS: Record<LogLevel, string> = {
  log: "#0a0",
  error: "#a22",
  warn: "#a70",
};

interface LogEntry {
  message: string;
  count: number;
  timestamp: number;
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  countEl: HTMLSpanElement | null;
  type: LogLevel;
}

export const LogsOverlay = () => {
  const { devMode } = useDevMode();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const activeRef = useRef(devMode);

  activeRef.current = devMode;

  useEffect(() => {
    const target = document.getElementById("dotcomma");
    if (!target) return;

    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      "position:fixed;bottom:12px;right:12px;z-index:1000;" +
      "max-height:50vh;display:flex;flex-direction:column;" +
      "pointer-events:auto;user-select:text;" +
      "font-family:'Kode Mono','Courier New',Courier,monospace;font-size:12px;line-height:1.5;" +
      "max-width:500px;";
    wrapper.addEventListener("mousedown", (e) => e.stopPropagation());
    wrapper.addEventListener("click", (e) => e.stopPropagation());

    // Toolbar (hidden until first log)
    const toolbar = document.createElement("div");
    toolbar.style.cssText =
      "display:none;justify-content:flex-end;gap:4px;margin-bottom:4px;";

    const btnStyle =
      "background:rgba(0,0,0,0.6);color:#0f0;border:1px solid #0f0;border-radius:4px;" +
      "padding:2px 8px;cursor:pointer;font:inherit;font-size:11px;";

    const copyAllBtn = document.createElement("button");
    copyAllBtn.style.cssText = btnStyle;
    copyAllBtn.textContent = "copy all";
    copyAllBtn.addEventListener("click", () => {
      const text = entriesRef.current
        .map((e) => (e.count > 1 ? `${e.message} ×${e.count}` : e.message))
        .join("\n");
      navigator.clipboard.writeText(text);
    });

    const clearAllBtn = document.createElement("button");
    clearAllBtn.style.cssText = btnStyle;
    clearAllBtn.textContent = "clear all";
    clearAllBtn.addEventListener("click", () => {
      for (const entry of entriesRef.current) entry.el.remove();
      entriesRef.current = [];
      toolbar.style.display = "none";
    });

    toolbar.appendChild(copyAllBtn);
    toolbar.appendChild(clearAllBtn);
    wrapper.appendChild(toolbar);

    const container = document.createElement("div");
    container.style.cssText =
      "overflow-y:auto;display:flex;flex-direction:column;justify-content:flex-end;";

    containerRef.current = wrapper;
    wrapper.appendChild(container);
    target.appendChild(wrapper);

    function addEntry(type: LogLevel, args: any[]) {
      if (!activeRef.current) return;

      const message = args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" ");

      const now = Date.now();
      const entries = entriesRef.current;

      const existing = entries.find((e) => e.message === message && e.type === type);
      if (existing) {
        existing.count++;
        existing.timestamp = now;
        if (existing.count === 2) {
          const badge = document.createElement("span");
          badge.style.cssText =
            `margin-left:8px;color:${BADGE_COLORS[type]};font-size:10px;opacity:0.7;`;
          badge.textContent = `×${existing.count}`;
          existing.textEl.appendChild(badge);
          existing.countEl = badge;
        } else if (existing.countEl) {
          existing.countEl.textContent = `×${existing.count}`;
        }
        container.appendChild(existing.el);
        container.scrollTop = container.scrollHeight;
        return;
      }

      const el = document.createElement("div");
      el.style.cssText =
        `background:rgba(0,0,0,0.6);color:${LOG_COLORS[type]};padding:4px 8px;border-radius:4px;` +
        "margin-top:2px;word-break:break-all;white-space:pre-wrap;display:flex;align-items:flex-start;gap:6px;";

      const copyBtn = document.createElement("button");
      copyBtn.style.cssText =
        `background:none;border:none;color:${LOG_COLORS[type]};cursor:pointer;padding:0;` +
        "font:inherit;font-size:10px;opacity:0.5;flex-shrink:0;line-height:1.5;";
      copyBtn.textContent = "⧉";
      copyBtn.addEventListener("mouseenter", () => { copyBtn.style.opacity = "1"; });
      copyBtn.addEventListener("mouseleave", () => { copyBtn.style.opacity = "0.5"; });
      copyBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(message);
      });

      const textSpan = document.createElement("span");
      textSpan.style.cssText = "flex:1;min-width:0;";
      textSpan.textContent = message;

      el.appendChild(copyBtn);
      el.appendChild(textSpan);

      const entry: LogEntry = { message, count: 1, timestamp: now, el, textEl: textSpan, countEl: null, type };
      entries.push(entry);
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      toolbar.style.display = "flex";
    }

    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      addEntry("log", args);
    };

    console.error = (...args: any[]) => {
      originalError.apply(console, args);
      addEntry("error", args);
    };

    console.warn = (...args: any[]) => {
      originalWarn.apply(console, args);
      addEntry("warn", args);
    };

    // Expiry sweep
    const interval = setInterval(() => {
      const now = Date.now();
      const entries = entriesRef.current;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (now - entries[i].timestamp >= EXPIRE_MS) {
          entries[i].el.remove();
          entries.splice(i, 1);
        }
      }
      if (entries.length === 0) toolbar.style.display = "none";
    }, CHECK_INTERVAL_MS);

    return () => {
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      clearInterval(interval);
      wrapper.remove();
      entriesRef.current = [];
    };
  }, []);

  // Toggle visibility
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.display = devMode ? "flex" : "none";
    }
  }, [devMode]);

  return null;
};
