/**
 * Shared worker-client base.
 *
 * Every generation worker (terrain, spawn, foliage, dressing, collider) talks
 * to the main thread the same way: lazily construct the Worker, send ONE
 * `INIT` message and wait for `INIT_DONE`, then correlate request/response
 * pairs by a numeric `id`. Each client used to hand-roll the pending-resolve
 * map, the id counter, the init handshake and the domain-switch teardown —
 * five copies that had to be kept in step. This is the one implementation;
 * a client module is now just its typed request wrappers.
 *
 * Webpack needs the `new Worker(new URL("./x.worker.ts", import.meta.url))`
 * literal at the call site to bundle the worker, which is why the client takes
 * a `create` factory instead of a URL.
 */

export interface WorkerClientOptions<TInit> {
  /** Construct the Worker — must be the literal `new Worker(new URL(...))`. */
  create: () => Worker;
  /** Build the INIT payload (sent as `{ type: "INIT", ...payload }`). Called
   *  once per worker lifetime, at ensure() time — may be async (e.g. await
   *  the active domain). Omit for workers that need no init handshake. */
  init?: () => TInit | Promise<TInit>;
  /** Message `type` field a request result arrives with. Any message of this
   *  type carrying an `id` resolves the matching request; other message types
   *  are forwarded to `onMessage`. Defaults to accepting any message with an
   *  `id` that has a pending request. */
  resultType?: string;
  /** Fire-and-forget messages that aren't request results. */
  onMessage?: (data: any) => void;
}

export interface WorkerClient<TInit = unknown> {
  /** Lazily create + init the worker (idempotent; concurrent callers share the
   *  same promise). Resolves once INIT_DONE arrived (or immediately when the
   *  client has no init step). */
  ensure: () => Promise<void>;
  /** True once the worker exists and has completed its handshake. */
  isReady: () => boolean;
  /** True while a worker instance exists (ready or still initializing). */
  exists: () => boolean;
  /** Send a request and resolve with the worker's reply payload. `message`
   *  gets an `id` field appended; the worker must echo it in its result. The
   *  request is queued behind ensure(). `transfer` lists ArrayBuffers to move
   *  instead of copy. */
  request: <T = any>(message: Record<string, unknown>, transfer?: Transferable[]) => Promise<T>;
  /** Fire-and-forget message (no reply expected). No-op when the worker does
   *  not exist yet — callers that need the worker should ensure() first. */
  post: (message: Record<string, unknown>, transfer?: Transferable[]) => void;
  /** Terminate the worker and forget every in-flight request (they never
   *  resolve — a domain switch unmounted their callers). The next ensure()
   *  boots a fresh worker and re-runs `init`. */
  reset: () => void;
}

export const createWorkerClient = <TInit = unknown>(options: WorkerClientOptions<TInit>): WorkerClient<TInit> => {
  let worker: Worker | null = null;
  let ready = false;
  let initPromise: Promise<void> | null = null;
  let nextId = 0;
  const pending = new Map<number, (data: any) => void>();

  const handleMessage = (e: MessageEvent) => {
    const data = e.data;
    if (data && typeof data.id === "number" && (!options.resultType || data.type === options.resultType)) {
      const resolve = pending.get(data.id);
      if (resolve) {
        pending.delete(data.id);
        resolve(data);
        return;
      }
    }
    options.onMessage?.(data);
  };

  const ensure = (): Promise<void> => {
    if (ready) return Promise.resolve();
    if (initPromise) return initPromise;
    initPromise = (async () => {
      // Resolve the init payload BEFORE constructing the worker: a reset()
      // during an awaited init (domain switch) must not leave a stray worker.
      const payload = options.init ? await options.init() : undefined;
      const thisInit = initPromise;
      const w = options.create();
      worker = w;
      if (!options.init) {
        w.onmessage = handleMessage;
        ready = true;
        return;
      }
      await new Promise<void>((resolve) => {
        w.onmessage = (e: MessageEvent) => {
          if (e.data?.type === "INIT_DONE") {
            w.onmessage = handleMessage;
            // Only publish readiness if this init wasn't reset() mid-flight.
            if (worker === w && initPromise === thisInit) ready = true;
            resolve();
          }
        };
        w.postMessage({ type: "INIT", ...(payload as object) });
      });
    })();
    return initPromise;
  };

  const request = async <T = any>(message: Record<string, unknown>, transfer?: Transferable[]): Promise<T> => {
    await ensure();
    const w = worker!;
    const id = nextId++;
    return new Promise<T>((resolve) => {
      pending.set(id, resolve);
      if (transfer) w.postMessage({ ...message, id }, transfer);
      else w.postMessage({ ...message, id });
    });
  };

  const post = (message: Record<string, unknown>, transfer?: Transferable[]) => {
    if (!worker) return;
    if (transfer) worker.postMessage(message, transfer);
    else worker.postMessage(message);
  };

  const reset = () => {
    worker?.terminate();
    worker = null;
    ready = false;
    initPromise = null;
    pending.clear();
  };

  return {
    ensure,
    isReady: () => ready,
    exists: () => worker !== null,
    request,
    post,
    reset,
  };
};
