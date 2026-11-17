export interface TraceEntry {
  t: number; // performance.now() at END of the span
  name: string;
  ms: number; // span duration (0 for instant events)
}
