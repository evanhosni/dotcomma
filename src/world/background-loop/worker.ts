// Not a createWorkerClient: the thread answers no requests, it only ticks.
export const startTicking = (intervalMs: number, onTick: () => void): (() => void) => {
  const worker = new Worker(new URL("./tick.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = onTick;
  worker.postMessage(intervalMs);
  return () => worker.terminate();
};
