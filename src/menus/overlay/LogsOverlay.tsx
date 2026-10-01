import { useEffect, useRef } from "react";
import { useDevContext } from "../../context/DevContext";
import { FONT_CSS, HUD_COLOR, HUD_Z_INDEX, PANEL_BACKGROUND } from "./styles";

const EXPIRE_MS = 30_000;
const CHECK_INTERVAL_MS = 1_000;

type LogLevel = "log" | "error" | "warn";
const LOG_LEVELS: readonly LogLevel[] = ["log", "error", "warn"];

const LOG_COLORS: Record<LogLevel, string> = {
  log: HUD_COLOR,
  error: "#f44",
  warn: "#fa0",
};

const BADGE_COLORS: Record<LogLevel, string> = {
  log: "#0a0",
  error: "#a22",
  warn: "#a70",
};

const TOOLBAR_BUTTON_CSS =
  `background:${PANEL_BACKGROUND};color:${HUD_COLOR};border:1px solid ${HUD_COLOR};border-radius:4px;` +
  "padding:2px 8px;cursor:pointer;font:inherit;font-size:11px;";

interface LogEntry {
  message: string;
  count: number;
  timestamp: number;
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  countEl: HTMLSpanElement | null;
  type: LogLevel;
}

const formatLogArgs = (args: any[]): string =>
  args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");

const createToolbarButton = (label: string, onClick: () => void): HTMLButtonElement => {
  const button = document.createElement("button");
  button.style.cssText = TOOLBAR_BUTTON_CSS;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

/** One log line: a copy button and the message text. */
const createEntryElement = (type: LogLevel, message: string): { el: HTMLDivElement; textEl: HTMLSpanElement } => {
  const el = document.createElement("div");
  el.style.cssText =
    `background:${PANEL_BACKGROUND};color:${LOG_COLORS[type]};padding:4px 8px;border-radius:4px;` +
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

  const textEl = document.createElement("span");
  textEl.style.cssText = "flex:1;min-width:0;";
  textEl.textContent = message;

  el.appendChild(copyBtn);
  el.appendChild(textEl);
  return { el, textEl };
};

/** A repeated message bumps its entry's ×N badge instead of adding a line. */
const bumpRepeat = (entry: LogEntry, now: number): void => {
  entry.count++;
  entry.timestamp = now;
  if (entry.count === 2) {
    const badge = document.createElement("span");
    badge.style.cssText = `margin-left:8px;color:${BADGE_COLORS[entry.type]};font-size:10px;opacity:0.7;`;
    badge.textContent = `×${entry.count}`;
    entry.textEl.appendChild(badge);
    entry.countEl = badge;
  } else if (entry.countEl) {
    entry.countEl.textContent = `×${entry.count}`;
  }
};

/** Captured console output (devmode only): repeats collapse into one line, lines expire after EXPIRE_MS. */
export const LogsOverlay = () => {
  const { devMode } = useDevContext();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const activeRef = useRef(devMode);

  activeRef.current = devMode;

  useEffect(() => {
    const target = document.getElementById("dotcomma");
    if (!target) return;

    const wrapper = document.createElement("div");
    wrapper.style.cssText =
      `position:fixed;bottom:12px;right:12px;z-index:${HUD_Z_INDEX};` +
      "max-height:50vh;display:flex;flex-direction:column;" +
      "pointer-events:auto;user-select:text;" +
      FONT_CSS +
      "max-width:500px;";
    wrapper.addEventListener("mousedown", (e) => e.stopPropagation());
    wrapper.addEventListener("click", (e) => e.stopPropagation());

    // Hidden until the first log.
    const toolbar = document.createElement("div");
    toolbar.style.cssText = "display:none;justify-content:flex-end;gap:4px;margin-bottom:4px;";
    toolbar.appendChild(
      createToolbarButton("copy all", () => {
        const text = entriesRef.current.map((e) => (e.count > 1 ? `${e.message} ×${e.count}` : e.message)).join("\n");
        navigator.clipboard.writeText(text);
      }),
    );
    toolbar.appendChild(
      createToolbarButton("clear all", () => {
        for (const entry of entriesRef.current) entry.el.remove();
        entriesRef.current = [];
        toolbar.style.display = "none";
      }),
    );
    wrapper.appendChild(toolbar);

    const container = document.createElement("div");
    container.style.cssText = "overflow-y:auto;display:flex;flex-direction:column;justify-content:flex-end;";

    containerRef.current = wrapper;
    wrapper.appendChild(container);
    target.appendChild(wrapper);

    const addEntry = (type: LogLevel, args: any[]) => {
      if (!activeRef.current) return;
      const message = formatLogArgs(args);
      const now = Date.now();
      const entries = entriesRef.current;

      const existing = entries.find((e) => e.message === message && e.type === type);
      if (existing) {
        bumpRepeat(existing, now);
        container.appendChild(existing.el);
        container.scrollTop = container.scrollHeight;
        return;
      }

      const { el, textEl } = createEntryElement(type, message);
      entries.push({ message, count: 1, timestamp: now, el, textEl, countEl: null, type });
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
      toolbar.style.display = "flex";
    };

    const originals = { log: console.log, error: console.error, warn: console.warn };
    for (const level of LOG_LEVELS) {
      const original = originals[level];
      console[level] = (...args: any[]) => {
        original.apply(console, args);
        addEntry(level, args);
      };
    }

    const expirySweep = setInterval(() => {
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
      for (const level of LOG_LEVELS) console[level] = originals[level];
      clearInterval(expirySweep);
      wrapper.remove();
      entriesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.display = devMode ? "flex" : "none";
    }
  }, [devMode]);

  return null;
};
