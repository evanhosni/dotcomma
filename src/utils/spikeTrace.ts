/**
 * Lightweight main-thread work tracer for lag-spike attribution.
 *
 * Hot systems wrap their potentially-heavy synchronous work in traceSpan (or
 * call traceEvent for instants); entries land in a fixed ring buffer exposed
 * as window.__spikeTrace. A frame-delta recorder (run from the console / the
 * browser extension) can then match a long frame's timestamp against exactly
 * what ran inside it. Overhead is one performance.now() pair + an array write
 * per traced call — safe to leave on permanently.
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

/** Record a synchronous span of work. Returns fn's result. */
export const traceSpan = <T>(name: string, fn: () => T): T => {
  const t0 = performance.now();
  const result = fn();
  const t1 = performance.now();
  push(t1, name, t1 - t0);
  return result;
};

/** Record an instant (something happened; duration unknown or elsewhere). */
export const traceEvent = (name: string, ms = 0): void => {
  push(performance.now(), name, ms);
};

/** All entries whose end time falls in [from, to], oldest first. */
export const traceWindow = (from: number, to: number): TraceEntry[] =>
  entries.filter((e) => e.t >= from && e.t <= to).sort((a, b) => a.t - b.t);

// Console / extension access
(window as any).__spikeTrace = { entries, traceWindow };
