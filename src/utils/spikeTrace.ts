/**
 * Lag-spike attribution ring buffer (window.__spikeTrace): match a long frame's
 * timestamps against what ran inside it. One performance.now() pair per traced
 * call — safe to leave on permanently. See CLAUDE.md Performance Notes.
 */

export interface TraceEntry {
  t: number; // performance.now() at END of the span
  name: string;
  ms: number; // span duration (0 for instant events)
}

const CAPACITY = 4000;
const entries: TraceEntry[] = [];
let writeIndex = 0;

const push = (t: number, name: string, ms: number): void => {
  if (entries.length < CAPACITY) {
    entries.push({ t, name, ms });
  } else {
    const e = entries[writeIndex];
    e.t = t;
    e.name = name;
    e.ms = ms;
    writeIndex = (writeIndex + 1) % CAPACITY;
  }
};

export const traceSpan = <T>(name: string, fn: () => T): T => {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  push(t1, name, t1 - t0);
  return result;
};

export const traceEvent = (name: string, ms = 0): void => {
  push(performance.now(), name, ms);
};

export const traceWindow = (from: number, to: number): TraceEntry[] =>
  entries.filter((e) => e.t >= from && e.t <= to).sort((a, b) => a.t - b.t);

(window as any).__spikeTrace = { entries, traceWindow };
