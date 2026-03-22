import { useEffect, useRef } from "react";
import { useUrlParameters } from "../../context/UrlParametersContext";

const EXPIRE_MS = 30_000;
const CHECK_INTERVAL_MS = 1_000;

interface LogEntry {
  message: string;
  count: number;
  timestamp: number;
  el: HTMLDivElement;
  countEl: HTMLSpanElement | null;
}

export const LogsOverlay = () => {
  const { params } = useUrlParameters();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const entriesRef = useRef<LogEntry[]>([]);
  const activeRef = useRef(params.logs);

  activeRef.current = params.logs;

  useEffect(() => {
    const target = document.getElementById("dotcomma");
    if (!target) return;

    const container = document.createElement("div");
    container.style.cssText =
      "position:fixed;bottom:12px;right:12px;z-index:1000;" +
      "max-height:50vh;overflow-y:auto;display:flex;flex-direction:column;justify-content:flex-end;" +
      "pointer-events:auto;user-select:text;" +
      "font-family:'Kode Mono','Courier New',Courier,monospace;font-size:12px;line-height:1.5;" +
      "max-width:500px;";
    container.addEventListener("mousedown", (e) => e.stopPropagation());
    container.addEventListener("click", (e) => e.stopPropagation());

    containerRef.current = container;
    target.appendChild(container);

    const originalLog = console.log;

    console.log = (...args: any[]) => {
      originalLog.apply(console, args);
      if (!activeRef.current) return;

      const message = args
        .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
        .join(" ");

      const now = Date.now();
      const entries = entriesRef.current;

      // Check for duplicate
      const existing = entries.find((e) => e.message === message);
      if (existing) {
        existing.count++;
        existing.timestamp = now;
        if (existing.count === 2) {
          const badge = document.createElement("span");
          badge.style.cssText =
            "margin-left:8px;color:#0a0;font-size:10px;opacity:0.7;";
          badge.textContent = `×${existing.count}`;
          existing.el.appendChild(badge);
          existing.countEl = badge;
        } else if (existing.countEl) {
          existing.countEl.textContent = `×${existing.count}`;
        }
        // Move to bottom
        container.appendChild(existing.el);
        container.scrollTop = container.scrollHeight;
        return;
      }

      const el = document.createElement("div");
      el.style.cssText =
        "background:rgba(0,0,0,0.6);color:#0f0;padding:4px 8px;border-radius:4px;" +
        "margin-top:2px;word-break:break-all;white-space:pre-wrap;";
      el.textContent = message;

      const entry: LogEntry = { message, count: 1, timestamp: now, el, countEl: null };
      entries.push(entry);
      container.appendChild(el);
      container.scrollTop = container.scrollHeight;
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
    }, CHECK_INTERVAL_MS);

    return () => {
      console.log = originalLog;
      clearInterval(interval);
      container.remove();
      entriesRef.current = [];
    };
  }, []);

  // Toggle visibility
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.display = params.logs ? "flex" : "none";
    }
  }, [params.logs]);

  return null;
};
