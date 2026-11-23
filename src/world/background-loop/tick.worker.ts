/**
 * A metronome. Timers on a hidden tab's main thread are throttled to 1Hz (and to once a minute after
 * five minutes in Chrome); a dedicated worker's are not, and its messages wake the main thread on time.
 *
 *   IN:  intervalMs (0 stops)
 *   OUT: a tick every intervalMs
 */
/* eslint-disable no-restricted-globals */
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<number>) => {
  if (timer !== undefined) clearInterval(timer);
  timer = e.data > 0 ? setInterval(() => self.postMessage(0), e.data) : undefined;
};

export {};
